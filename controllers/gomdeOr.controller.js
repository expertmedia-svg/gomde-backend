const GomdeOr = require('../models/gomdeOr');
const User = require('../models/user');
const Battle = require('../models/battle');

const CURRENT_YEAR = 2026;

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Récupère ou crée l'édition courante.
 */
async function getOrCreateEdition(year = CURRENT_YEAR) {
  let edition = await GomdeOr.findOne({ year });
  if (!edition) {
    edition = await GomdeOr.create({ year });
  }
  return edition;
}

function syncEditionState(edition) {
  const now = new Date();
  if (edition.status === 'upcoming' && now >= edition.registrationStart) {
    edition.status = 'registration';
  }
  edition.calculateRankings();
}

// ── GET /gomde-or — Infos de l'édition courante ─────────────────────
exports.getEdition = async (req, res) => {
  try {
    const edition = await getOrCreateEdition();
    syncEditionState(edition);

    const totalParticipants = edition.entries.length;
    const provinces = {};
    edition.entries.forEach((e) => {
      provinces[e.province] = (provinces[e.province] || 0) + 1;
    });

    res.json({
      year: edition.year,
      title: edition.title,
      description: edition.description,
      status: edition.status,
      registrationStart: edition.registrationStart,
      registrationEnd: edition.registrationEnd,
      qualificationsStart: edition.qualificationsStart,
      semifinalsStart: edition.semifinalsStart,
      finalsDate: edition.finalsDate,
      ceremonyDate: edition.ceremonyDate,
      totalParticipants,
      participantsByProvince: provinces,
      prizes: edition.prizes,
      nationalChampion: edition.nationalChampion,
      nationalRunnerUp: edition.nationalRunnerUp,
    });
  } catch (error) {
    console.error('[GomdeOr] getEdition error:', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// ── GET /gomde-or/leaderboard — Classement ──────────────────────────
exports.getLeaderboard = async (req, res) => {
  try {
    const { province, city, neighborhood, limit = 50, page = 1 } = req.query;
    const edition = await getOrCreateEdition();
    syncEditionState(edition);

    let filtered = [...edition.entries];

    if (province) {
      filtered = filtered.filter((e) => e.province === province);
    }
    if (city) {
      filtered = filtered.filter((e) => e.city === city);
    }
    if (neighborhood) {
      filtered = filtered.filter((e) => e.neighborhood === neighborhood);
    }

    // Trier par points desc
    filtered.sort((a, b) => b.points - a.points);

    const total = filtered.length;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const paginated = filtered.slice(skip, skip + parseInt(limit));

    // Populate les users
    const userIds = paginated.map((e) => e.user);
    const users = await User.find({ _id: { $in: userIds } })
      .select('username profile.avatar profile.city profile.neighborhood profile.region stats.score')
      .lean();

    const userMap = {};
    users.forEach((u) => { userMap[u._id.toString()] = u; });

    const leaderboard = paginated.map((entry, index) => {
      const user = userMap[entry.user.toString()] || {};
      return {
        rank: skip + index + 1,
        user: {
          _id: entry.user,
          username: user.username || 'Inconnu',
          avatar: user.profile?.avatar,
          city: entry.city,
          neighborhood: entry.neighborhood,
          province: entry.province,
        },
        points: entry.points,
        wins: entry.wins,
        losses: entry.losses,
        totalBattles: entry.totalBattles,
        totalVotesReceived: entry.totalVotesReceived,
        trophies: entry.trophies,
        provinceRank: entry.provinceRank,
        neighborhoodRank: entry.neighborhoodRank,
        nationalRank: entry.nationalRank,
      };
    });

    res.json({
      leaderboard,
      total,
      totalPages: Math.ceil(total / parseInt(limit)),
      currentPage: parseInt(page),
      filters: { province, city, neighborhood },
    });
  } catch (error) {
    console.error('[GomdeOr] getLeaderboard error:', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// ── GET /gomde-or/my-entry — Mon inscription ────────────────────────
exports.getMyEntry = async (req, res) => {
  try {
    const edition = await getOrCreateEdition();
    syncEditionState(edition);
    const entry = edition.entries.find(
      (e) => e.user.toString() === req.user.id
    );

    if (!entry) {
      return res.json({ registered: false });
    }

    // Calculer le rang dans sa province
    const sameProvince = edition.entries
      .filter((e) => e.province === entry.province)
      .sort((a, b) => b.points - a.points);
    const provinceRank = sameProvince.findIndex(
      (e) => e.user.toString() === req.user.id
    ) + 1;

    // Rang national
    const allSorted = [...edition.entries].sort((a, b) => b.points - a.points);
    const nationalRank = allSorted.findIndex(
      (e) => e.user.toString() === req.user.id
    ) + 1;

    res.json({
      registered: true,
      points: entry.points,
      wins: entry.wins,
      losses: entry.losses,
      totalBattles: entry.totalBattles,
      totalVotesReceived: entry.totalVotesReceived,
      province: entry.province,
      city: entry.city,
      neighborhood: entry.neighborhood,
      trophies: entry.trophies,
      provinceRank,
      nationalRank,
      totalProvince: sameProvince.length,
      totalNational: allSorted.length,
    });
  } catch (error) {
    console.error('[GomdeOr] getMyEntry error:', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// ── POST /gomde-or/register — Inscription manuelle ──────────────────
exports.register = async (req, res) => {
  try {
    const edition = await getOrCreateEdition();
    const now = new Date();

    if (now < edition.registrationStart) {
      return res.status(400).json({
        message: `Les inscriptions ouvrent le ${edition.registrationStart.toLocaleDateString('fr-FR')}`
      });
    }
    if (edition.registrationEnd && now > edition.registrationEnd) {
      return res.status(400).json({ message: 'Les inscriptions sont fermées.' });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'Utilisateur non trouvé' });

    if (!user.profile?.region || !user.profile?.city) {
      return res.status(400).json({
        message: 'Complète ton profil (ville et province) avant de t\'inscrire au GOMDE D\'OR.'
      });
    }

    const existing = edition.entries.find(
      (e) => e.user.toString() === user._id.toString()
    );
    if (existing) {
      return res.json({ message: 'Tu es déjà inscrit !', entry: existing });
    }

    const entry = edition.autoRegisterUser(user);
    if (!entry) {
      return res.status(400).json({
        message: 'Impossible de t\'inscrire. Vérifie ton profil (ville et province).'
      });
    }
    entry.isAutoRegistered = false;

    await edition.save();
    res.status(201).json({ message: 'Inscription au GOMDE D\'OR réussie !', entry });
  } catch (error) {
    console.error('[GomdeOr] register error:', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// ── POST /gomde-or/auto-register — Auto inscription (appelé par le cron) ──
exports.autoRegisterFromBattle = async (battleId) => {
  try {
    const edition = await getOrCreateEdition();
    const now = new Date();

    // Vérifier que c'est la période d'inscription ou de qualification
    if (now < edition.registrationStart) return;
    if (!['registration', 'qualifications'].includes(edition.status)) return;

    const battle = await Battle.findById(battleId)
      .populate('creator', 'profile')
      .populate('challenger', 'profile');

    if (!battle) return;

    // Auto-inscrire les deux participants
    for (const participant of [battle.creator, battle.challenger]) {
      if (!participant) continue;
      const user = await User.findById(participant._id || participant);
      if (!user || !user.profile?.region || !user.profile?.city) continue;
      edition.autoRegisterUser(user);
    }

    await edition.save();
  } catch (error) {
    console.error('[GomdeOr] autoRegisterFromBattle error:', error);
  }
};

// ── Mise à jour des scores après une battle terminée ────────────────
exports.updateScoresFromBattle = async (battle) => {
  try {
    const edition = await getOrCreateEdition();
    const now = new Date();
    if (now < edition.registrationStart) return;

    if (!battle.winner) return;

    const winnerId = battle.winner.toString();

    // Compter les votes par participant
    const voteCounts = {};
    battle.votes.forEach((v) => {
      const id = v.votedFor?.toString();
      if (id) voteCounts[id] = (voteCounts[id] || 0) + 1;
    });

    for (const entry of battle.entries) {
      const userId = entry.user?.toString();
      if (!userId) continue;
      const isWinner = userId === winnerId;
      const votes = voteCounts[userId] || 0;
      edition.updateParticipantScore(userId, isWinner, votes);
    }

    // Lier la battle au championnat
    edition.battles.push({
      battle: battle._id,
      phase: 'qualification',
      province: null // sera déduit du participant
    });

    await edition.save();
  } catch (error) {
    console.error('[GomdeOr] updateScoresFromBattle error:', error);
  }
};

// ── GET /gomde-or/province-results — Résultats par province ─────────
exports.getProvinceResults = async (req, res) => {
  try {
    const edition = await getOrCreateEdition();
    syncEditionState(edition);

    // Regrouper par province
    const byProvince = {};
    edition.entries.forEach((e) => {
      if (!byProvince[e.province]) byProvince[e.province] = [];
      byProvince[e.province].push(e);
    });

    const results = [];
    const userIds = edition.entries.map((e) => e.user);
    const users = await User.find({ _id: { $in: userIds } })
      .select('username profile.avatar')
      .lean();
    const userMap = {};
    users.forEach((u) => { userMap[u._id.toString()] = u; });

    for (const [province, participants] of Object.entries(byProvince)) {
      participants.sort((a, b) => b.points - a.points);
      const top = participants.slice(0, 5).map((p, i) => {
        const user = userMap[p.user.toString()] || {};
        return {
          rank: i + 1,
          userId: p.user,
          username: user.username || 'Inconnu',
          avatar: user.profile?.avatar,
          city: p.city,
          points: p.points,
          wins: p.wins,
          trophies: p.trophies,
        };
      });

      results.push({
        province,
        totalParticipants: participants.length,
        top,
      });
    }

    results.sort((a, b) => b.totalParticipants - a.totalParticipants);
    res.json({ provinceResults: results });
  } catch (error) {
    console.error('[GomdeOr] getProvinceResults error:', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// ── GET /gomde-or/trophies — Tous les trophées décernés ─────────────
exports.getTrophies = async (req, res) => {
  try {
    const edition = await getOrCreateEdition();
    syncEditionState(edition);

    const allTrophies = [];
    const userIds = [];

    edition.entries.forEach((entry) => {
      if (entry.trophies && entry.trophies.length > 0) {
        entry.trophies.forEach((t) => {
          allTrophies.push({
            userId: entry.user,
            province: entry.province,
            city: entry.city,
            neighborhood: entry.neighborhood,
            trophy: t,
          });
          if (!userIds.includes(entry.user.toString())) {
            userIds.push(entry.user.toString());
          }
        });
      }
    });

    const users = await User.find({ _id: { $in: userIds } })
      .select('username profile.avatar')
      .lean();
    const userMap = {};
    users.forEach((u) => { userMap[u._id.toString()] = u; });

    const enriched = allTrophies.map((t) => {
      const user = userMap[t.userId.toString()] || {};
      return {
        ...t,
        username: user.username || 'Inconnu',
        avatar: user.profile?.avatar,
      };
    });

    res.json({ trophies: enriched });
  } catch (error) {
    console.error('[GomdeOr] getTrophies error:', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};
