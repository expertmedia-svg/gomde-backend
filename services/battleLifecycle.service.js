const Battle = require('../models/battle');
const { applyBattleOutcomeStats } = require('./score.service');
const { syncBattleChampions } = require('./champion.service');

const LIVE_STATUSES = new Set(['active', 'voting']);

const markBattleLive = (battle, now = new Date()) => {
  battle.status = 'active';
  battle.startDate = battle.startDate || now;
  battle.voteDeadline = battle.voteDeadline || new Date(now.getTime() + Battle.VOTING_WINDOW_MS);
  battle.endDate = battle.voteDeadline;
  battle.lifecycle = {
    ...(battle.lifecycle || {}),
    inLiveFeed: true,
    enteredLiveAt: battle.lifecycle?.enteredLiveAt || now,
    archivedAt: null,
    lastStateChangeAt: now,
  };
};

const archiveBattle = (battle, now, completionReason) => {
  battle.lifecycle = {
    ...(battle.lifecycle || {}),
    inLiveFeed: false,
    archivedAt: now,
    lastStateChangeAt: now,
    completionReason,
  };
  battle.completedAt = now;
};

const finalizeBattle = async (battle, { completionReason = 'vote_expired' } = {}) => {
  if (!battle) {
    return null;
  }

  const now = new Date();
  const result = await battle.calculateWinner();
  const resolvedBattle = result || battle;
  archiveBattle(resolvedBattle, now, completionReason);
  await resolvedBattle.save();
  await applyBattleOutcomeStats(resolvedBattle);
  await syncBattleChampions(resolvedBattle);
  return resolvedBattle;
};

const finalizeForfeit = async (battle, { completionReason = 'submission_expired' } = {}) => {
  if (!battle) {
    return null;
  }

  const now = new Date();
  const submitter = battle.entries.find((entry) => entry.videoUrl && entry.user);
  battle.status = 'forfeited';
  battle.winner = submitter?.user || null;
  archiveBattle(battle, now, completionReason);
  await battle.save();

  if (battle.winner) {
    await applyBattleOutcomeStats(battle);
    await syncBattleChampions(battle);
  }

  return battle;
};

const syncBattleLifecycle = async (battle) => {
  if (!battle) {
    return null;
  }

  if (battle.status === 'accepted' && battle.isSubmissionExpired()) {
    return finalizeForfeit(battle);
  }

  if (LIVE_STATUSES.has(battle.status) && battle.isVotingExpired()) {
    return finalizeBattle(battle);
  }

  return battle;
};

module.exports = {
  finalizeBattle,
  finalizeForfeit,
  markBattleLive,
  syncBattleLifecycle,
};