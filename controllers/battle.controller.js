const mongoose = require('mongoose');
const Battle = require('../models/battle');
const User = require('../models/user');
const Video = require('../models/video');

const normalizeObjectId = (value) => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return mongoose.isValidObjectId(trimmed) ? trimmed : null;
};

const readBattleId = (req, res) => {
  const battleId = normalizeObjectId(req.params.id);

  if (!battleId) {
    res.status(400).json({ message: 'Invalid battle id' });
    return null;
  }

  return battleId;
};

exports.createBattle = async (req, res) => {
  try {
    const { title, description, rules, endDate } = req.body;
    const normalizedTitle = title?.trim() || 'Battle studio';
    const normalizedDescription = description?.trim() || undefined;
    const normalizedRules = {
      maxDuration: Number(rules?.maxDuration) > 0 ? Number(rules.maxDuration) : 60,
      allowInstrumentals: rules?.allowInstrumentals !== false,
      requiredOriginal: rules?.requiredOriginal === true
    };
    const normalizedEndDate = endDate ? new Date(endDate) : null;
    
    const battle = await Battle.create({
      title: normalizedTitle,
      description: normalizedDescription,
      creator: req.user._id,
      entries: [{ user: req.user._id }],
      prize: 0,
      rules: normalizedRules,
      endDate: normalizedEndDate && !Number.isNaN(normalizedEndDate.getTime())
        ? normalizedEndDate
        : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    });
    
    res.status(201).json(battle);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.getBattles = async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const query = {};
    
    if (status) query.status = status;
    
    const battles = await Battle.find(query)
      .populate('creator', 'username profile.avatar stats.score')
      .populate('challenger', 'username profile.avatar stats.score')
      .populate('entries.user', 'username profile.avatar')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);
    
    const total = await Battle.countDocuments(query);
    
    res.json({
      battles,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.getBattleById = async (req, res) => {
  try {
    const battleId = readBattleId(req, res);
    if (!battleId) {
      return;
    }

    const battle = await Battle.findById(battleId)
      .populate('creator', 'username profile.avatar stats.score')
      .populate('challenger', 'username profile.avatar stats.score')
      .populate('entries.user', 'username profile.avatar stats.score')
      .populate('votes.user', 'username')
      .populate('winner', 'username profile.avatar');
    
    if (!battle) {
      return res.status(404).json({ message: 'Battle not found' });
    }
    
    res.json(battle);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.joinBattle = async (req, res) => {
  try {
    const battleId = readBattleId(req, res);
    if (!battleId) {
      return;
    }

    const battle = await Battle.findById(battleId);
    
    if (!battle) {
      return res.status(404).json({ message: 'Battle not found' });
    }
    
    if (battle.status !== 'pending' && battle.status !== 'accepted') {
      return res.status(400).json({ message: 'Battle already started or completed' });
    }
    
    if (battle.entries.length >= 2) {
      return res.status(400).json({ message: 'Battle already has 2 participants' });
    }
    
    battle.challenger = req.user._id;
    battle.status = 'accepted';
    battle.entries.push({ user: req.user._id });
    
    await battle.save();
    
    res.json(battle);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.submitEntry = async (req, res) => {
  try {
    const { videoUrl, videoPublicId, thumbnailUrl } = req.body;
    const battleId = readBattleId(req, res);
    if (!battleId) {
      return;
    }

    const battle = await Battle.findById(battleId);
    
    if (!battle) {
      return res.status(404).json({ message: 'Battle not found' });
    }
    
    const entry = battle.entries.find(e => e.user.toString() === req.user._id.toString());
    
    if (!entry) {
      return res.status(403).json({ message: 'You are not a participant in this battle' });
    }
    
    const resolvedVideoUrl = req.file ? `/uploads/videos/${req.file.filename}` : videoUrl;
    const resolvedVideoPublicId = req.file ? req.file.filename : videoPublicId;
    const resolvedThumbnailUrl = thumbnailUrl || '';

    if (!resolvedVideoUrl) {
      return res.status(400).json({ message: 'Video file or video URL is required' });
    }

    entry.videoUrl = resolvedVideoUrl;
    entry.videoPublicId = resolvedVideoPublicId;
    entry.thumbnailUrl = resolvedThumbnailUrl;
    
    if (battle.entries.every(e => e.videoUrl)) {
      battle.status = 'active';
      battle.startDate = new Date();
    }
    
    await battle.save();
    
    // Create video record
    await Video.create({
      title: `${battle.title} - Entry by ${req.user.username}`,
      user: req.user._id,
      videoUrl: resolvedVideoUrl,
      videoPublicId: resolvedVideoPublicId,
      thumbnailUrl: resolvedThumbnailUrl,
      battleId: battle._id
    });
    
    res.json(battle);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.vote = async (req, res) => {
  try {
    const { votedFor } = req.body;
    const battleId = readBattleId(req, res);
    if (!battleId) {
      return;
    }

    const normalizedVotedFor = normalizeObjectId(votedFor);
    if (!normalizedVotedFor) {
      return res.status(400).json({ message: 'Invalid votedFor user id' });
    }

    const battle = await Battle.findById(battleId);
    
    if (!battle) {
      return res.status(404).json({ message: 'Battle not found' });
    }
    
    if (battle.status !== 'active') {
      return res.status(400).json({ message: 'Battle is not active' });
    }

    const votedParticipant = battle.entries.some(
      (entry) => entry.user && entry.user.toString() === normalizedVotedFor
    );

    if (!votedParticipant) {
      return res.status(400).json({ message: 'Vote target is not part of this battle' });
    }
    
    const hasVoted = battle.votes.some(v => v.user.toString() === req.user._id.toString());
    
    if (hasVoted) {
      return res.status(400).json({ message: 'You have already voted' });
    }
    
    battle.votes.push({
      user: req.user._id,
      votedFor: normalizedVotedFor
    });
    
    await battle.save();
    
    // Auto-calculate winner if all votes are in (simplified)
    if (battle.votes.length >= 10) {
      await battle.calculateWinner();
    }
    
    res.json(battle);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.likeBattle = async (req, res) => {
  try {
    const battleId = readBattleId(req, res);
    if (!battleId) {
      return;
    }

    const battle = await Battle.findById(battleId);
    
    if (!battle) {
      return res.status(404).json({ message: 'Battle not found' });
    }
    
    const index = battle.likes.indexOf(req.user._id);
    if (index === -1) {
      battle.likes.push(req.user._id);
    } else {
      battle.likes.splice(index, 1);
    }
    
    await battle.save();
    
    res.json({ likes: battle.likes.length, liked: index === -1 });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};