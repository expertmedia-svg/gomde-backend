const Battle = require('../models/battle');
const ChampionSnapshot = require('../models/championSnapshot');
const User = require('../models/user');
const { calculateOfficialScore } = require('./score.service');
const { normalizeLocationKey, resolveRegionFromCity } = require('./location.service');

const CHAMPION_LEVELS = Object.freeze(['sector', 'regional', 'national']);

const buildScopeDescriptor = (user, level) => {
  const city = user?.profile?.city || null;
  const neighborhood = user?.profile?.neighborhood || null;
  const region = user?.profile?.region || resolveRegionFromCity(city);

  if (level === 'sector') {
    if (!neighborhood) {
      return null;
    }

    const key = [normalizeLocationKey(city), normalizeLocationKey(neighborhood)]
      .filter(Boolean)
      .join('::');
    if (!key) {
      return null;
    }

    return {
      geographyKey: key,
      geographyLabel: city ? `${neighborhood}, ${city}` : neighborhood,
      filterUser: (candidate) => (
        normalizeLocationKey(candidate?.profile?.neighborhood) === normalizeLocationKey(neighborhood) &&
        normalizeLocationKey(candidate?.profile?.city) === normalizeLocationKey(city)
      ),
    };
  }

  if (level === 'regional') {
    if (!region) {
      return null;
    }

    return {
      geographyKey: normalizeLocationKey(region),
      geographyLabel: region,
      filterUser: (candidate) => normalizeLocationKey(candidate?.profile?.region || resolveRegionFromCity(candidate?.profile?.city)) === normalizeLocationKey(region),
    };
  }

  return {
    geographyKey: 'bf',
    geographyLabel: 'Burkina Faso',
    filterUser: () => true,
  };
};

const buildCategoryStats = (battles, candidateIds) => {
  const statsByUserId = new Map();

  for (const battle of battles) {
    const candidateEntryIds = battle.entries
      .map((entry) => entry.user && String(entry.user))
      .filter((userId) => candidateIds.has(userId));

    if (candidateEntryIds.length === 0) {
      continue;
    }

    const voteCounts = new Map();
    for (const vote of battle.votes || []) {
      const votedFor = vote?.votedFor && String(vote.votedFor);
      if (!votedFor) {
        continue;
      }
      voteCounts.set(votedFor, (voteCounts.get(votedFor) || 0) + 1);
    }

    for (const userId of candidateEntryIds) {
      const snapshot = statsByUserId.get(userId) || {
        wins: 0,
        totalBattles: 0,
        totalVotesReceived: 0,
        lastWinAt: 0,
      };

      snapshot.totalBattles += 1;
      snapshot.totalVotesReceived += voteCounts.get(userId) || 0;
      if (battle.winner && String(battle.winner) === userId) {
        snapshot.wins += 1;
        snapshot.lastWinAt = Math.max(snapshot.lastWinAt, new Date(battle.createdAt).getTime());
      }

      statsByUserId.set(userId, snapshot);
    }
  }

  return statsByUserId;
};

const rankChampionCandidates = (candidates, statsByUserId) => candidates
  .map((user) => {
    const stats = statsByUserId.get(String(user._id)) || {
      wins: 0,
      totalBattles: 0,
      totalVotesReceived: 0,
      lastWinAt: 0,
    };

    return {
      user,
      officialScore: calculateOfficialScore(user.stats),
      ...stats,
    };
  })
  .sort((left, right) => {
    if (right.wins !== left.wins) return right.wins - left.wins;
    if (right.officialScore !== left.officialScore) return right.officialScore - left.officialScore;
    if (right.totalVotesReceived !== left.totalVotesReceived) return right.totalVotesReceived - left.totalVotesReceived;
    if (right.totalBattles !== left.totalBattles) return right.totalBattles - left.totalBattles;
    if (right.lastWinAt !== left.lastWinAt) return right.lastWinAt - left.lastWinAt;
    return String(left.user._id).localeCompare(String(right.user._id));
  });

const syncChampionSnapshot = async ({
  category,
  level,
  scope,
  rankedChampion,
  sourceBattleId,
  now,
}) => {
  const current = await ChampionSnapshot.findOne({
    category,
    level,
    geographyKey: scope.geographyKey,
    active: true,
  });

  if (!rankedChampion || rankedChampion.wins <= 0) {
    if (current) {
      current.active = false;
      current.endedAt = now;
      await current.save();
    }
    return null;
  }

  const holderId = String(rankedChampion.user._id);
  if (current && String(current.holder) === holderId) {
    current.stats = {
      officialScore: rankedChampion.officialScore,
      wins: rankedChampion.wins,
      totalBattles: rankedChampion.totalBattles,
      totalVotesReceived: rankedChampion.totalVotesReceived,
    };
    current.sourceBattle = sourceBattleId;
    current.geographyLabel = scope.geographyLabel;
    await current.save();
    return current;
  }

  if (current) {
    current.active = false;
    current.endedAt = now;
    await current.save();
  }

  return ChampionSnapshot.create({
    category,
    level,
    geographyKey: scope.geographyKey,
    geographyLabel: scope.geographyLabel,
    holder: rankedChampion.user._id,
    previousHolder: current?.holder,
    sourceBattle: sourceBattleId,
    stats: {
      officialScore: rankedChampion.officialScore,
      wins: rankedChampion.wins,
      totalBattles: rankedChampion.totalBattles,
      totalVotesReceived: rankedChampion.totalVotesReceived,
    },
    active: true,
    startedAt: now,
  });
};

const syncBattleChampions = async (battle) => {
  if (!battle?.winner || !Array.isArray(battle.categories) || battle.categories.length === 0) {
    return [];
  }

  const winner = await User.findById(battle.winner).select('profile stats isActive role');
  if (!winner || !winner.isActive || winner.role === 'admin') {
    return [];
  }

  const now = new Date();
  const championUpdates = [];

  for (const category of battle.categories) {
    for (const level of CHAMPION_LEVELS) {
      const scope = buildScopeDescriptor(winner, level);
      if (!scope) {
        continue;
      }

      const candidates = await User.find({
        isActive: true,
        role: { $ne: 'admin' },
        disciplines: category,
      }).select('profile stats createdAt disciplines');

      const scopedCandidates = candidates.filter(scope.filterUser);
      if (scopedCandidates.length === 0) {
        continue;
      }

      const candidateIds = new Set(scopedCandidates.map((candidate) => String(candidate._id)));
      const battles = await Battle.find({
        status: { $in: ['completed', 'forfeited'] },
        winner: { $exists: true, $ne: null },
        categories: category,
        'entries.user': { $in: [...candidateIds] },
      }).select('winner votes entries.user createdAt');

      const rankedCandidates = rankChampionCandidates(
        scopedCandidates,
        buildCategoryStats(battles, candidateIds)
      );

      const updatedSnapshot = await syncChampionSnapshot({
        category,
        level,
        scope,
        rankedChampion: rankedCandidates[0],
        sourceBattleId: battle._id,
        now,
      });

      if (updatedSnapshot) {
        championUpdates.push(updatedSnapshot);
      }
    }
  }

  return championUpdates;
};

const getChampionForLeaderboard = async ({ category, level, user }) => {
  const scope = buildScopeDescriptor(user, level);
  if (!scope) {
    return null;
  }

  const snapshot = await ChampionSnapshot.findOne({
    category,
    level,
    geographyKey: scope.geographyKey,
    active: true,
  }).populate('holder', 'username profile.avatar profile.city profile.neighborhood profile.region stats.score');

  if (!snapshot) {
    return null;
  }

  return {
    category: snapshot.category,
    level: snapshot.level,
    geographyKey: snapshot.geographyKey,
    geographyLabel: snapshot.geographyLabel,
    holder: snapshot.holder,
    stats: snapshot.stats,
    startedAt: snapshot.startedAt,
  };
};

module.exports = {
  CHAMPION_LEVELS,
  getChampionForLeaderboard,
  syncBattleChampions,
};