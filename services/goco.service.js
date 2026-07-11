const GocoTransaction = require('../models/gocoTransaction');
const GocoWithdrawal = require('../models/gocoWithdrawal');
const User = require('../models/user');

const REWARD_TABLE = Object.freeze({
  video_view: 0.25,
  audio_play: 0.2,
  content_share: 0.6,
  manual_bonus: 1,
});

const PROGRAM_RULES = Object.freeze({
  minWithdrawal: 25,
  payoutMethods: ['mobile_money', 'bank_transfer'],
  mobileMoneyCountries: ['BF'],
  conversionHint: '1 GOCO = 1 unite interne de remuneration, conversion finale confirmee par l admin.',
});

const roundAmount = (value) => Math.round(Number(value || 0) * 100) / 100;

const grantGocoReward = async ({
  userId,
  actorId = null,
  actionType,
  targetType,
  targetId,
  metadata = {},
  eventKey,
}) => {
  if (!userId || !actionType || !targetType || !targetId) {
    return { awarded: false, reason: 'missing-params' };
  }

  if (actorId && String(actorId) === String(userId)) {
    return { awarded: false, reason: 'self-action' };
  }

  const amount = roundAmount(REWARD_TABLE[actionType]);
  if (!amount) {
    return { awarded: false, reason: 'unknown-action' };
  }

  if (eventKey) {
    const existing = await GocoTransaction.findOne({ eventKey }).lean();
    if (existing) {
      return { awarded: false, reason: 'duplicate', transaction: existing };
    }
  }

  // Atomic $inc instead of read-modify-write: concurrent rewards (e.g.
  // simultaneous views on popular content) must never clobber each other,
  // since this balance is withdrawable as real money.
  const user = await User.findByIdAndUpdate(
    userId,
    {
      $inc: {
        'wallet.balance': amount,
        'wallet.lifetimeEarned': amount,
      },
      $set: { 'wallet.lastRewardAt': new Date() },
    },
    { new: true, select: 'wallet' }
  );
  if (!user) {
    return { awarded: false, reason: 'user-not-found' };
  }

  const balance = roundAmount(user.wallet.balance);

  const transaction = await GocoTransaction.create({
    user: userId,
    actor: actorId,
    amount,
    actionType,
    targetType,
    targetId: String(targetId),
    eventKey,
    balanceAfter: balance,
    metadata,
  });

  return {
    awarded: true,
    amount,
    balance,
    transaction,
  };
};

const grantManualBonus = async ({ userId, adminId, amount, note = '' }) => {
  const normalizedAmount = roundAmount(amount);
  if (normalizedAmount <= 0) {
    throw new Error('Invalid bonus amount');
  }

  return grantGocoReward({
    userId,
    actorId: adminId,
    actionType: 'manual_bonus',
    targetType: 'wallet',
    targetId: String(userId),
    metadata: { note },
    eventKey: `manual_bonus:${userId}:${adminId}:${Date.now()}`,
  });
};

const requestWithdrawal = async ({ userId, amount, payoutMethod, payoutLabel }) => {
  const normalizedAmount = roundAmount(amount);
  if (normalizedAmount < PROGRAM_RULES.minWithdrawal) {
    throw new Error(`Minimum withdrawal is ${PROGRAM_RULES.minWithdrawal} GOCO`);
  }

  if (!PROGRAM_RULES.payoutMethods.includes(payoutMethod)) {
    throw new Error('Unsupported payout method');
  }

  // Atomic conditional update: the balance check and the deduction happen as
  // one operation, so two concurrent withdrawal requests can't both pass the
  // check and then both deduct (which would let a user withdraw more than
  // their real balance).
  const user = await User.findOneAndUpdate(
    { _id: userId, 'wallet.balance': { $gte: normalizedAmount } },
    {
      $inc: {
        'wallet.balance': -normalizedAmount,
        'wallet.pendingBalance': normalizedAmount,
      },
    },
    { new: true, select: 'wallet' }
  );

  if (!user) {
    const exists = await User.exists({ _id: userId });
    throw new Error(exists ? 'Insufficient balance' : 'User not found');
  }

  const withdrawal = await GocoWithdrawal.create({
    user: userId,
    amount: normalizedAmount,
    payoutMethod,
    payoutLabel,
  });

  await GocoTransaction.create({
    user: userId,
    amount: normalizedAmount,
    actionType: 'withdrawal_request',
    targetType: 'wallet',
    targetId: String(withdrawal._id),
    eventKey: `withdrawal_request:${withdrawal._id}`,
    balanceAfter: roundAmount(user.wallet.balance),
    metadata: { payoutMethod, payoutLabel },
  });

  return { withdrawal, wallet: user.wallet };
};

const reviewWithdrawal = async ({ withdrawalId, adminId, status, adminNote = '' }) => {
  const withdrawal = await GocoWithdrawal.findById(withdrawalId);
  if (!withdrawal) {
    throw new Error('Withdrawal not found');
  }

  if (withdrawal.status !== 'pending') {
    throw new Error('Withdrawal already reviewed');
  }

  if (!['approved', 'rejected'].includes(status)) {
    throw new Error('Invalid review status');
  }

  const inc = { 'wallet.pendingBalance': -withdrawal.amount };
  if (status === 'rejected') {
    inc['wallet.balance'] = withdrawal.amount;
  }

  const user = await User.findByIdAndUpdate(
    withdrawal.user,
    { $inc: inc },
    { new: true, select: 'wallet' }
  );
  if (!user) {
    throw new Error('User not found');
  }

  if (status === 'rejected') {
    await GocoTransaction.create({
      user: withdrawal.user,
      actor: adminId,
      amount: withdrawal.amount,
      actionType: 'withdrawal_rejected',
      targetType: 'wallet',
      targetId: String(withdrawal._id),
      eventKey: `withdrawal_rejected:${withdrawal._id}`,
      balanceAfter: roundAmount(user.wallet.balance),
      metadata: { adminNote },
    });
  }

  withdrawal.status = status;
  withdrawal.reviewedBy = adminId;
  withdrawal.reviewedAt = new Date();
  withdrawal.adminNote = adminNote;
  await withdrawal.save();

  return { withdrawal, wallet: user.wallet };
};

const listWithdrawals = async ({ userId = null, status = null, limit = 30 }) => {
  const query = {};
  if (userId) {
    query.user = userId;
  }
  if (status) {
    query.status = status;
  }

  return GocoWithdrawal.find(query)
    .populate('user', 'username email')
    .populate('reviewedBy', 'username')
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
};

module.exports = {
  PROGRAM_RULES,
  REWARD_TABLE,
  grantGocoReward,
  grantManualBonus,
  listWithdrawals,
  requestWithdrawal,
  reviewWithdrawal,
};