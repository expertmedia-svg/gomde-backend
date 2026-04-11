const GocoTransaction = require('../models/gocoTransaction');
const User = require('../models/user');
const {
  PROGRAM_RULES,
  grantManualBonus,
  listWithdrawals,
  requestWithdrawal,
  reviewWithdrawal,
} = require('../services/goco.service');

exports.getWallet = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('wallet username');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      userId: String(user._id),
      username: user.username,
      wallet: {
        balance: Number(user.wallet?.balance || 0),
        lifetimeEarned: Number(user.wallet?.lifetimeEarned || 0),
        pendingBalance: Number(user.wallet?.pendingBalance || 0),
        lastRewardAt: user.wallet?.lastRewardAt || null,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.getTransactions = async (req, res) => {
  try {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const transactions = await GocoTransaction.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    res.json({
      transactions: transactions.map((entry) => ({
        id: String(entry._id),
        amount: Number(entry.amount || 0),
        actionType: entry.actionType,
        targetType: entry.targetType,
        targetId: entry.targetId,
        balanceAfter: Number(entry.balanceAfter || 0),
        metadata: entry.metadata || {},
        createdAt: entry.createdAt,
      })),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.getProgram = async (req, res) => {
  res.json({
    rules: PROGRAM_RULES,
  });
};

exports.requestWithdrawal = async (req, res) => {
  try {
    const amount = Number(req.body?.amount || 0);
    const payoutMethod = String(req.body?.payoutMethod || '').trim();
    const payoutLabel = String(req.body?.payoutLabel || '').trim();

    if (!payoutLabel) {
      return res.status(400).json({ message: 'payoutLabel is required' });
    }

    const result = await requestWithdrawal({
      userId: req.user._id,
      amount,
      payoutMethod,
      payoutLabel,
    });

    res.status(201).json({
      withdrawal: result.withdrawal,
      wallet: result.wallet,
    });
  } catch (error) {
    console.error(error);
    res.status(400).json({ message: error.message || 'Unable to request withdrawal' });
  }
};

exports.getMyWithdrawals = async (req, res) => {
  try {
    const withdrawals = await listWithdrawals({ userId: req.user._id, limit: 50 });
    res.json({ withdrawals });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.adminGrantBonus = async (req, res) => {
  try {
    const userId = String(req.body?.userId || '').trim();
    const amount = Number(req.body?.amount || 0);
    const note = String(req.body?.note || '').trim();
    const result = await grantManualBonus({
      userId,
      adminId: req.user._id,
      amount,
      note,
    });
    res.status(201).json(result);
  } catch (error) {
    console.error(error);
    res.status(400).json({ message: error.message || 'Unable to grant bonus' });
  }
};

exports.adminListWithdrawals = async (req, res) => {
  try {
    const status = req.query?.status ? String(req.query.status).trim() : null;
    const withdrawals = await listWithdrawals({ status, limit: 100 });
    res.json({ withdrawals });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.adminReviewWithdrawal = async (req, res) => {
  try {
    const status = String(req.body?.status || '').trim();
    const adminNote = String(req.body?.adminNote || '').trim();
    const result = await reviewWithdrawal({
      withdrawalId: req.params.id,
      adminId: req.user._id,
      status,
      adminNote,
    });
    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(400).json({ message: error.message || 'Unable to review withdrawal' });
  }
};