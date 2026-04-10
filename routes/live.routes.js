const express = require('express');
const mongoose = require('mongoose');
const { AccessToken } = require('livekit-server-sdk');
const { protect } = require('../middleware/auth');
const Battle = require('../models/battle');
const User = require('../models/user');

const router = express.Router();

// ── GET /api/live/arena — Feed des battles en arène (voting + active) ──
router.get('/arena', async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const query = {
      status: { $in: ['active', 'voting'] },
      'entries.1': { $exists: true } // Au moins 2 vidéos soumises
    };

    if (status === 'active') query.status = 'active';
    if (status === 'voting') query.status = { $in: ['active', 'voting'] };

    const battles = await Battle.find(query)
      .populate('creator', 'username profile.avatar profile.city')
      .populate('challenger', 'username profile.avatar profile.city')
      .populate('entries.user', 'username profile.avatar profile.city')
      .populate('winner', 'username profile.avatar')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await Battle.countDocuments(query);

    // Calculer les infos de vote pour chaque battle
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const enriched = battles.map((battle) => {
      const voteBreakdown = {};
      battle.entries.forEach((entry) => {
        const uid = entry.user?._id?.toString();
        if (uid) voteBreakdown[uid] = 0;
      });
      (battle.votes || []).forEach((v) => {
        const votedFor = v.votedFor?.toString();
        if (votedFor && voteBreakdown[votedFor] !== undefined) {
          voteBreakdown[votedFor]++;
        }
      });

      // Abs URLs pour les vidéos
      battle.entries.forEach((entry) => {
        if (entry.videoUrl && !entry.videoUrl.startsWith('http')) {
          entry.videoUrl = `${baseUrl}${entry.videoUrl}`;
        }
        if (entry.thumbnailUrl && !entry.thumbnailUrl.startsWith('http')) {
          entry.thumbnailUrl = `${baseUrl}${entry.thumbnailUrl}`;
        }
      });

      return {
        ...battle,
        totalVotes: (battle.votes || []).length,
        voteBreakdown,
        timeRemaining: battle.voteDeadline
          ? Math.max(0, new Date(battle.voteDeadline).getTime() - Date.now())
          : null,
      };
    });

    res.json({
      battles: enriched,
      total,
      totalPages: Math.ceil(total / parseInt(limit)),
      currentPage: parseInt(page),
    });
  } catch (error) {
    console.error('[Live Arena] Error:', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// ── GET /api/live/arena/:id — Détail d'un battle dans l'arène ───────
router.get('/arena/:id', async (req, res) => {
  try {
    const battleId = req.params.id?.trim();
    if (!mongoose.isValidObjectId(battleId)) {
      return res.status(400).json({ message: 'ID invalide' });
    }

    const battle = await Battle.findById(battleId)
      .populate('creator', 'username profile.avatar profile.city stats.score')
      .populate('challenger', 'username profile.avatar profile.city stats.score')
      .populate('entries.user', 'username profile.avatar profile.city stats.score')
      .populate('winner', 'username profile.avatar')
      .populate('votes.user', 'username')
      .lean();

    if (!battle) {
      return res.status(404).json({ message: 'Battle introuvable' });
    }

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    battle.entries.forEach((entry) => {
      if (entry.videoUrl && !entry.videoUrl.startsWith('http')) {
        entry.videoUrl = `${baseUrl}${entry.videoUrl}`;
      }
      if (entry.thumbnailUrl && !entry.thumbnailUrl.startsWith('http')) {
        entry.thumbnailUrl = `${baseUrl}${entry.thumbnailUrl}`;
      }
    });

    const voteBreakdown = {};
    battle.entries.forEach((entry) => {
      const uid = entry.user?._id?.toString();
      if (uid) voteBreakdown[uid] = 0;
    });
    (battle.votes || []).forEach((v) => {
      const votedFor = v.votedFor?.toString();
      if (votedFor && voteBreakdown[votedFor] !== undefined) {
        voteBreakdown[votedFor]++;
      }
    });

    res.json({
      ...battle,
      totalVotes: (battle.votes || []).length,
      voteBreakdown,
      timeRemaining: battle.voteDeadline
        ? Math.max(0, new Date(battle.voteDeadline).getTime() - Date.now())
        : null,
    });
  } catch (error) {
    console.error('[Live Arena Detail] Error:', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

router.get('/token/:battleId', protect, async (req, res) => {
  try {
    const battleId = typeof req.params.battleId === 'string'
      ? req.params.battleId.trim()
      : '';
    const requestedRole = req.query.role === 'participant'
      ? 'participant'
      : 'spectator';

    if (!mongoose.isValidObjectId(battleId)) {
      return res.status(400).json({
        enabled: false,
        message: 'Invalid battle id'
      });
    }

    const battle = await Battle.findById(battleId).select('_id status startDate entries.user');
    if (!battle) {
      return res.status(404).json({
        enabled: false,
        message: 'Battle not found'
      });
    }

    if (!['active', 'voting'].includes(battle.status)) {
      return res.status(409).json({
        enabled: false,
        message: 'Battle is not live yet'
      });
    }

    const isBattleParticipant = battle.entries.some((entry) => (
      entry.user && entry.user.toString() === req.user._id.toString()
    ));

    if (requestedRole === 'participant' && !isBattleParticipant) {
      return res.status(403).json({
        enabled: false,
        message: 'Only battle participants can join as participants'
      });
    }

    if (!process.env.LIVEKIT_URL || !process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
      return res.status(503).json({
        enabled: false,
        message: 'LiveKit is not configured'
      });
    }

    const roomName = `battle-${battleId}`;
    const identity = `gomde-${req.user._id}`;
    const participantName = req.user.username || 'GOMDE user';
    const token = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
      identity,
      name: participantName,
      metadata: JSON.stringify({
        userId: String(req.user._id),
        username: participantName,
        role: requestedRole,
        battleId
      })
    });

    token.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: requestedRole === 'participant',
      canSubscribe: true,
      canPublishData: requestedRole === 'participant'
    });

    return res.json({
      enabled: true,
      provider: 'livekit',
      url: process.env.LIVEKIT_URL,
      roomName,
      identity,
      participantName,
      token: await token.toJwt()
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Unable to create live token' });
  }
});

module.exports = router;