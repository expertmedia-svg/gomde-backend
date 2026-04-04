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

    const battleExists = await Battle.exists({ _id: battleId });
    if (!battleExists) {
      return res.status(404).json({
        enabled: false,
        message: 'Battle not found'
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