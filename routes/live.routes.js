const express = require('express');
const mongoose = require('mongoose');
const { AccessToken } = require('livekit-server-sdk');
const { protect } = require('../middleware/auth');
const Battle = require('../models/battle');

const router = express.Router();

router.get('/token/:battleId', protect, async (req, res) => {
  try {
    const battleId = typeof req.params.battleId === 'string'
      ? req.params.battleId.trim()
      : '';
    const { role = 'spectator' } = req.query;

    if (!mongoose.isValidObjectId(battleId)) {
      return res.status(400).json({
        enabled: false,
        message: 'Invalid battle id'
      });
    }

    const battle = await Battle.findById(battleId).select('_id status startDate');
    if (!battle) {
      return res.status(404).json({
        enabled: false,
        message: 'Battle not found'
      });
    }

    if (battle.status !== 'active') {
      return res.status(409).json({
        enabled: false,
        message: 'Battle is not live yet'
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
        role,
        battleId
      })
    });

    token.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: role === 'participant',
      canSubscribe: true,
      canPublishData: role === 'participant'
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