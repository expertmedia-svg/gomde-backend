const express = require('express');
const mongoose = require('mongoose');
const Report = require('../models/report');
const { protect } = require('../middleware/auth');
const { buildActionLimiter } = require('../middleware/traffic');

const router = express.Router();
const limiter = buildActionLimiter({ windowMs: 60 * 60 * 1000, max: 20, prefix: 'report' });

router.post('/', protect, limiter, async (req, res) => {
  try {
    const { targetType, targetId, reason, details } = req.body;
    if (!mongoose.isValidObjectId(targetId)) {
      return res.status(400).json({ message: 'Contenu invalide.' });
    }
    const report = await Report.findOneAndUpdate(
      { reporter: req.user._id, targetType, targetId },
      { $set: { reason, details: String(details || '').trim(), status: 'pending', createdAt: new Date() } },
      { upsert: true, new: true, runValidators: true },
    );
    res.status(201).json({ reportId: report._id, message: 'Signalement reçu.' });
  } catch (error) {
    if (error?.name === 'ValidationError') {
      return res.status(400).json({ message: 'Motif de signalement invalide.' });
    }
    console.error(error);
    res.status(500).json({ message: 'Signalement impossible.' });
  }
});

module.exports = router;
