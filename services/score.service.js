const User = require('../models/user');

const calculateOfficialScore = (stats = {}) => {
  const wins = Number(stats?.battles?.wins || 0);
  const losses = Number(stats?.battles?.losses || 0);
  const totalBattles = Number(stats?.battles?.total || 0);
  const totalLikes = Number(stats?.totalLikes || 0);
  const totalViews = Number(stats?.totalViews || 0);
  const totalShares = Number(stats?.totalShares || 0);
  const totalBattleVotes = Number(stats?.totalBattleVotes || 0);

  return Math.max(
    0,
    Math.round(
      wins * 150 +
        losses * (-50) +
        totalBattles * 25 +
        totalBattleVotes * 4 +
        totalLikes * 3 +
        totalShares * 6 +
        totalViews
    )
  );
};

const recomputeUserScoreById = async (userId) => {
  if (!userId) {
    return null;
  }

  const user = await User.findById(userId);
  if (!user) {
    return null;
  }

  user.stats.score = calculateOfficialScore(user.stats);
  await user.save({ validateBeforeSave: false });
  return user;
};

const recomputeUsersScores = async (userIds = []) => {
  const uniqueIds = [...new Set(userIds.filter(Boolean).map((value) => String(value)))];
  await Promise.all(uniqueIds.map((userId) => recomputeUserScoreById(userId)));
};

const awardBattleVote = async (userId) => {
  if (!userId) {
    return null;
  }

  await User.findByIdAndUpdate(userId, {
    $inc: { 'stats.totalBattleVotes': 1 },
  });

  return recomputeUserScoreById(userId);
};

const applyBattleOutcomeStats = async (battle) => {
  if (!battle || battle.status !== 'completed' || battle.resultApplied) {
    return battle;
  }

  const participantIds = battle.entries
    .map((entry) => entry.user && String(entry.user))
    .filter(Boolean);

  if (participantIds.length === 0) {
    battle.resultApplied = true;
    await battle.save();
    return battle;
  }

  const winnerId = battle.winner ? String(battle.winner) : null;
  const updates = participantIds.map((participantId) => ({
    updateOne: {
      filter: { _id: participantId },
      update: {
        $inc: {
          'stats.battles.total': 1,
          'stats.battles.wins': winnerId === participantId ? 1 : 0,
          'stats.battles.losses': winnerId && winnerId !== participantId ? 1 : 0,
        },
      },
    },
  }));

  if (updates.length > 0) {
    await User.bulkWrite(updates);
  }

  battle.resultApplied = true;
  await battle.save();
  await recomputeUsersScores(participantIds);

  return battle;
};

module.exports = {
  applyBattleOutcomeStats,
  awardBattleVote,
  calculateOfficialScore,
  recomputeUserScoreById,
  recomputeUsersScores,
};