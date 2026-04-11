const mongoose = require('mongoose');
const Battle = require('../models/battle');
const User = require('../models/user');
const Video = require('../models/video');
const { buildDisciplinePayload } = require('../constants/disciplines');
const { buildFileIntegrity } = require('../services/fileIntegrity.service');
const { uploadLocalFile } = require('../services/mediaStorage.service');
const { applyBattleOutcomeStats, awardBattleVote } = require('../services/score.service');
const { markBattleLive, syncBattleLifecycle } = require('../services/battleLifecycle.service');
const { updateScoresFromBattle, autoRegisterFromBattle } = require('./gomdeOr.controller');

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

const handleBattleError = (res, error) => {
  if (error?.name === 'CastError' && error?.path === '_id') {
    return res.status(400).json({ message: 'Invalid battle id' });
  }

  if (error?.name === 'CastError' && error?.path === 'votedFor') {
    return res.status(400).json({ message: 'Invalid votedFor user id' });
  }

  console.error(error);
  return res.status(500).json({ message: 'Server error' });
};

const populateBattle = (query) =>
  query
    .populate('creator', 'username profile.avatar stats.score')
    .populate('challenger', 'username profile.avatar stats.score')
    .populate('entries.user', 'username profile.avatar stats.score')
    .populate('winner', 'username profile.avatar');

const findExistingDirectBattle = async (firstUserId, secondUserId) => {
  return Battle.findOne({
    status: { $in: ['challenged', 'accepted', 'active', 'voting'] },
    $or: [
      { creator: firstUserId, challenger: secondUserId },
      { creator: secondUserId, challenger: firstUserId },
    ],
  }).sort({ createdAt: -1 });
};

// ── Create battle & challenge a user ─────────────────────────────────
exports.createBattle = async (req, res) => {
  try {
    const { title, description, rules, challengedUserId, category, categories } = req.body;
    const normalizedTitle = title?.trim() || 'Battle studio';
    const normalizedDescription = description?.trim() || undefined;
    const normalizedCategories = buildDisciplinePayload(categories || category);
    const normalizedRules = {
      maxDuration: Number(rules?.maxDuration) > 0 ? Number(rules.maxDuration) : 60,
      allowInstrumentals: rules?.allowInstrumentals !== false,
      requiredOriginal: rules?.requiredOriginal === true
    };

    // Si un adversaire est spécifié → challenge direct
    const normalizedChallengerId = normalizeObjectId(challengedUserId);
    let challenger = null;
    let status = 'pending';

    if (normalizedChallengerId) {
      if (normalizedChallengerId === req.user._id.toString()) {
        return res.status(400).json({ message: 'Vous ne pouvez pas vous défier vous-même' });
      }

      const conflictingBattle = await findExistingDirectBattle(
        req.user._id,
        normalizedChallengerId,
      );
      if (conflictingBattle) {
        return res.status(409).json({
          message: 'Un duel est déjà en cours ou en attente avec cette personne.',
          battleId: conflictingBattle._id,
          status: conflictingBattle.status,
        });
      }

      challenger = await User.findById(normalizedChallengerId);
      if (!challenger) {
        return res.status(404).json({ message: 'Utilisateur défié introuvable' });
      }
      status = 'challenged';
    }

    const battle = await Battle.create({
      title: normalizedTitle,
      description: normalizedDescription,
      primaryCategory: normalizedCategories.primaryCategory,
      categories: normalizedCategories.categories,
      creator: req.user._id,
      challenger: challenger ? challenger._id : undefined,
      entries: [{ user: req.user._id }],
      prize: 0,
      rules: normalizedRules,
      status
    });

    // Notifier le challenger via socket
    if (challenger) {
      const io = req.app.get('io');
      if (io) {
        io.to(`user_${challenger._id}`).emit('battle-challenge', {
          battleId: battle._id.toString(),
          title: normalizedTitle,
          challenger: {
            userId: req.user._id.toString(),
            username: req.user.username,
          },
        });
      }
    }

    res.status(201).json(battle);

    // GOMDE D'OR : auto-inscrire les participants
    autoRegisterFromBattle(battle._id).catch(() => {});
  } catch (error) {
    return handleBattleError(res, error);
  }
};

// ── List battles ─────────────────────────────────────────────────────
exports.getBattles = async (req, res) => {
  try {
    const { status, page = 1, limit = 10, category } = req.query;
    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(50, Math.max(1, Number(limit) || 10));
    const query = {};

    if (status) query.status = status;
    if (category) {
      const normalizedCategory = buildDisciplinePayload(category, { fallback: [] }).categories;
      if (normalizedCategory.length > 0) {
        query.categories = { $in: normalizedCategory };
      }
    }

    const battles = await populateBattle(Battle.find(query))
      .sort({ createdAt: -1 })
      .limit(safeLimit)
      .skip((safePage - 1) * safeLimit);

    const total = await Battle.countDocuments(query);

    await Promise.all(battles.map((battle) => syncBattleLifecycle(battle)));

    res.json({
      battles,
      totalPages: Math.ceil(total / safeLimit),
      currentPage: safePage,
      total
    });
  } catch (error) {
    return handleBattleError(res, error);
  }
};

// ── Get my pending challenges (received) ─────────────────────────────
exports.getMyChallenges = async (req, res) => {
  try {
    const challenges = await populateBattle(
      Battle.find({
        challenger: req.user._id,
        status: 'challenged'
      })
    ).sort({ createdAt: -1 });

    res.json({ challenges });
  } catch (error) {
    return handleBattleError(res, error);
  }
};

// ── Get battle by id ─────────────────────────────────────────────────
exports.getBattleById = async (req, res) => {
  try {
    const battleId = readBattleId(req, res);
    if (!battleId) {
      return;
    }

    let battle = await populateBattle(Battle.findById(battleId))
      .populate('votes.user', 'username');

    if (!battle) {
      return res.status(404).json({ message: 'Battle not found' });
    }

    battle = await syncBattleLifecycle(battle);

    res.json(battle);
  } catch (error) {
    return handleBattleError(res, error);
  }
};

// ── Accept challenge ─────────────────────────────────────────────────
exports.acceptChallenge = async (req, res) => {
  try {
    const battleId = readBattleId(req, res);
    if (!battleId) return;

    const battle = await Battle.findById(battleId);
    if (!battle) {
      return res.status(404).json({ message: 'Battle not found' });
    }

    if (battle.status !== 'challenged') {
      return res.status(400).json({ message: 'Ce challenge ne peut plus être accepté' });
    }

    if (battle.challenger?.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Seul le challenger défié peut accepter' });
    }

    const now = new Date();
    battle.status = 'accepted';
    battle.acceptedAt = now;
    battle.submissionDeadline = new Date(now.getTime() + Battle.SUBMISSION_WINDOW_MS);

    const challengerAlreadyPresent = battle.entries.some(
      (entry) => entry.user?.toString() === req.user._id.toString()
    );
    if (!challengerAlreadyPresent) {
      battle.entries.push({ user: req.user._id });
    }

    await battle.save();

    // Notifier le créateur
    const io = req.app.get('io');
    if (io) {
      io.to(`user_${battle.creator}`).emit('battle-accepted', {
        battleId: battle._id.toString(),
        title: battle.title,
        challenger: {
          userId: req.user._id.toString(),
          username: req.user.username,
        },
      });
    }

    const populated = await populateBattle(Battle.findById(battle._id));
    res.json(populated);
  } catch (error) {
    return handleBattleError(res, error);
  }
};

// ── Refuse challenge ─────────────────────────────────────────────────
exports.refuseChallenge = async (req, res) => {
  try {
    const battleId = readBattleId(req, res);
    if (!battleId) return;

    const battle = await Battle.findById(battleId);
    if (!battle) {
      return res.status(404).json({ message: 'Battle not found' });
    }

    if (battle.status !== 'challenged') {
      return res.status(400).json({ message: 'Ce challenge ne peut plus être refusé' });
    }

    if (battle.challenger?.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Seul le challenger défié peut refuser' });
    }

    battle.status = 'refused';
    await battle.save();

    // Notifier le créateur
    const io = req.app.get('io');
    if (io) {
      io.to(`user_${battle.creator}`).emit('battle-refused', {
        battleId: battle._id.toString(),
        title: battle.title,
      });
    }

    res.json(battle);
  } catch (error) {
    return handleBattleError(res, error);
  }
};

// ── Join battle (pour les battles ouvertes sans challenger prédéfini) ─
exports.joinBattle = async (req, res) => {
  try {
    const battleId = readBattleId(req, res);
    if (!battleId) {
      return;
    }

    const userId = req.user._id;
    const now = new Date();

    // Atomic update: only succeed if status=pending, entries < 2, and user not already in
    const battle = await Battle.findOneAndUpdate(
      {
        _id: battleId,
        status: 'pending',
        'entries.user': { $ne: userId },
        $expr: { $lt: [{ $size: '$entries' }, 2] }
      },
      {
        $set: {
          challenger: userId,
          status: 'accepted',
          acceptedAt: now,
          submissionDeadline: new Date(now.getTime() + Battle.SUBMISSION_WINDOW_MS)
        },
        $push: { entries: { user: userId } }
      },
      { new: true }
    );

    if (!battle) {
      return res.status(400).json({ message: 'Impossible de rejoindre ce duel (complet, déjà rejoint, ou non disponible)' });
    }

    const populated = await populateBattle(Battle.findById(battle._id));
    res.json(populated);
  } catch (error) {
    return handleBattleError(res, error);
  }
};

// ── Submit video entry ───────────────────────────────────────────────
exports.submitEntry = async (req, res) => {
  try {
    const { videoUrl, videoPublicId, thumbnailUrl } = req.body;
    const battleId = readBattleId(req, res);
    if (!battleId) {
      return;
    }

    let battle = await Battle.findById(battleId);

    if (!battle) {
      return res.status(404).json({ message: 'Battle not found' });
    }

    battle = await syncBattleLifecycle(battle);

    // Vérifier que la battle est en phase de soumission
    if (battle.status !== 'accepted') {
      return res.status(400).json({ message: 'La battle n\'est pas en phase de soumission' });
    }

    if (battle.status === 'forfeited') {
      return res.status(400).json({ message: 'La deadline de soumission (24h) est dépassée' });
    }

    const entry = battle.entries.find(e => e.user.toString() === req.user._id.toString());

    if (!entry) {
      return res.status(403).json({ message: 'You are not a participant in this battle' });
    }

    if (entry.videoUrl) {
      return res.status(400).json({ message: 'Vous avez déjà soumis votre vidéo' });
    }

    const storedEntryVideo = req.file
      ? await uploadLocalFile({
          req,
          localPath: req.file.path,
          subdirectory: 'videos',
          fileName: req.file.filename,
          contentType: req.file.mimetype,
        })
      : null;
    const resolvedVideoUrl = storedEntryVideo?.publicUrl || videoUrl;
    const resolvedVideoPublicId = storedEntryVideo?.objectKey || (req.file ? req.file.filename : videoPublicId);
    const resolvedThumbnailUrl = thumbnailUrl || '';

    if (!resolvedVideoUrl) {
      return res.status(400).json({ message: 'Video file or video URL is required' });
    }

    entry.videoUrl = resolvedVideoUrl;
    entry.videoPublicId = resolvedVideoPublicId;
    entry.thumbnailUrl = resolvedThumbnailUrl;
    entry.uploadedAt = new Date();

    const integrity = await buildFileIntegrity(req.file);
    entry.uploadChecksum = integrity?.checksum || '';
    entry.uploadSizeBytes = integrity?.sizeBytes || 0;
    entry.uploadMimeType = integrity?.mimeType || '';

    // Si les 2 vidéos sont soumises → passer en phase de vote
    if (battle.entries.every(e => e.videoUrl) && battle.entries.length === 2) {
      markBattleLive(battle, new Date());
    }

    await battle.save();

    // Create video record
    await Video.create({
      title: `${battle.title} - Entry by ${req.user.username}`,
      type: 'battle',
      primaryCategory: battle.primaryCategory,
      categories: battle.categories,
      user: req.user._id,
      videoUrl: resolvedVideoUrl,
      videoPublicId: resolvedVideoPublicId,
      thumbnailUrl: resolvedThumbnailUrl,
      uploadChecksum: integrity?.checksum || '',
      uploadSizeBytes: integrity?.sizeBytes || 0,
      uploadMimeType: integrity?.mimeType || '',
      battleId: battle._id
    });

    // Notifier via socket
    const io = req.app.get('io');
    if (io) {
      io.to(battleId).emit('entry-submitted', {
        battleId,
        userId: req.user._id.toString(),
        username: req.user.username,
        status: battle.status,
      });
    }

    const populated = await populateBattle(Battle.findById(battle._id));
    res.json(populated);
  } catch (error) {
    return handleBattleError(res, error);
  }
};

// ── Vote ─────────────────────────────────────────────────────────────
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

    let battle = await Battle.findById(battleId);

    if (!battle) {
      return res.status(404).json({ message: 'Battle not found' });
    }

    battle = await syncBattleLifecycle(battle);

    if (!['active', 'voting'].includes(battle.status)) {
      return res.status(400).json({ message: 'Battle is not in voting phase' });
    }

    // Vérifier si la période de vote est terminée
    if (battle.isVotingExpired()) {
      await syncBattleLifecycle(battle);
      return res.status(400).json({ message: 'La période de vote est terminée' });
    }

    const votedParticipant = battle.entries.some(
      (entry) => entry.user && entry.user.toString() === normalizedVotedFor
    );

    if (!votedParticipant) {
      return res.status(400).json({ message: 'Vote target is not part of this battle' });
    }

    // Les participants ne peuvent pas voter
    const isParticipant = battle.entries.some(
      (entry) => entry.user && entry.user.toString() === req.user._id.toString()
    );
    if (isParticipant) {
      return res.status(400).json({ message: 'Les participants ne peuvent pas voter' });
    }

    // Atomic vote: prevent double voting via findOneAndUpdate
    const updatedBattle = await Battle.findOneAndUpdate(
      {
        _id: battleId,
        status: { $in: ['active', 'voting'] },
        'votes.user': { $ne: req.user._id }
      },
      {
        $push: {
          votes: {
            user: req.user._id,
            votedFor: normalizedVotedFor,
            createdAt: new Date()
          }
        }
      },
      { new: true }
    );

    if (!updatedBattle) {
      return res.status(400).json({ message: 'Vote déjà enregistré ou battle non disponible' });
    }

    await awardBattleVote(normalizedVotedFor);

    const io = req.app.get('io');
    if (io) {
      const voteBreakdown = updatedBattle.entries.map((entry) => {
        const participantId = entry.user?.toString();
        const count = participantId
          ? updatedBattle.votes.filter((voteItem) => voteItem.votedFor?.toString() === participantId).length
          : 0;

        return {
          userId: participantId,
          votes: count,
        };
      });

      io.to(battleId).emit('vote-updated', {
        battleId,
        totalVotes: updatedBattle.votes.length,
        votedFor: normalizedVotedFor,
        voter: {
          userId: req.user._id.toString(),
          username: req.user.username,
        },
        voteBreakdown,
      });
    }

    res.json(updatedBattle);
  } catch (error) {
    return handleBattleError(res, error);
  }
};

// ── Like ─────────────────────────────────────────────────────────────
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

// ── Auto-close expired battles (called periodically) ─────────────────
exports.closeExpiredBattles = async () => {
  const now = new Date();

  // Forfeits: battles accepted mais deadline de soumission dépassée sans les 2 vidéos
  const forfeitBattles = await Battle.find({
    status: 'accepted',
    submissionDeadline: { $lte: now }
  });

  for (const battle of forfeitBattles) {
    const syncedBattle = await syncBattleLifecycle(battle);
    if (syncedBattle?.status === 'forfeited' && syncedBattle.winner) {
      await updateScoresFromBattle(syncedBattle);
    }
  }

  // Vote deadline: battles actives dont la période de vote est terminée
  const expiredVoteBattles = await Battle.find({
    status: { $in: ['active', 'voting'] },
    voteDeadline: { $lte: now }
  });

  for (const battle of expiredVoteBattles) {
    const finalizedBattle = await syncBattleLifecycle(battle);
    // GOMDE D'OR : mettre à jour les scores
    await updateScoresFromBattle(finalizedBattle || battle);
  }

  return {
    forfeited: forfeitBattles.length,
    completed: expiredVoteBattles.length
  };
};