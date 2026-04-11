const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { protect } = require('../middleware/auth');
const { buildRouteCache } = require('../middleware/cache');
const { buildActionLimiter } = require('../middleware/traffic');
const User = require('../models/user');
const Video = require('../models/video');
const AudioTrack = require('../models/audiotrack');
const {
  normalizeLocationKey,
  resolveRegionFromCity,
} = require('../services/location.service');
const { buildDisciplinePayload } = require('../constants/disciplines');
const { getChampionForLeaderboard } = require('../services/champion.service');
const { calculateOfficialScore } = require('../services/score.service');
const { toPublicMediaUrl } = require('../services/mediaStorage.service');

const resolveUserRegion = (user) => {
  const profile = user.profile || {};
  if (profile.region) {
    return profile.region;
  }

  return resolveRegionFromCity(profile.city);
};

const safeResolveUserRegion = (user) => {
  try {
    return resolveUserRegion(user);
  } catch (error) {
    return user?.profile?.region || null;
  }
};

const buildLeaderboardRow = (user, rank) => {
  const profile = user.profile || {};
  const stats = user.stats || {};

  return {
    ...user.toObject(),
    rank,
    region: safeResolveUserRegion(user),
    city: profile.city || null,
    neighborhood: profile.neighborhood || null,
    score: calculateOfficialScore(stats),
    wins: Number(stats?.battles?.wins || 0),
    totalViews: Number(stats.totalViews || 0),
    totalLikes: Number(stats.totalLikes || 0),
  };
};

const followLimiter = buildActionLimiter({
  windowMs: 10 * 60 * 1000,
  max: 50,
  prefix: 'user-follow',
  paramName: 'id',
});

const favoritesLimiter = buildActionLimiter({
  windowMs: 60 * 1000,
  max: 60,
  prefix: 'user-favorites',
});

const compactFavoriteUser = (user) => {
  if (!user) {
    return null;
  }

  return {
    _id: user._id,
    id: String(user._id),
    username: user.username || 'Artiste',
    primaryDiscipline: user.primaryDiscipline || null,
    city: user.profile?.city || null,
    region: user.profile?.region || null,
    profile: {
      avatar: user.profile?.avatar || '',
      city: user.profile?.city || null,
      region: user.profile?.region || null,
    },
  };
};

const compactCommentUser = (user) => {
  if (!user) {
    return null;
  }

  return {
    _id: user._id,
    id: String(user._id),
    username: user.username || 'Communauté',
    profile: {
      avatar: user.profile?.avatar || '',
    },
  };
};

const buildSavedVideoItem = (req, video) => ({
  _id: video._id,
  id: String(video._id),
  targetType: 'video',
  title: video.title || 'Sans titre',
  description: video.description || '',
  videoUrl: toPublicMediaUrl(req, video.videoUrl),
  thumbnailUrl: toPublicMediaUrl(req, video.thumbnailUrl),
  user: compactFavoriteUser(video.user),
  likes: Array.isArray(video.likes) ? video.likes : [],
  comments: Array.isArray(video.comments)
    ? video.comments.map((comment) => ({
        ...comment,
        _id: comment._id,
        user: compactCommentUser(comment.user),
      }))
    : [],
  shares: Number(video.shares || 0),
  views: Number(video.views || 0),
  type: video.type || 'freestyle',
  primaryCategory: video.primaryCategory || null,
  categories: Array.isArray(video.categories) ? video.categories : [],
  battleId: video.battleId ? String(video.battleId) : null,
  isAudio: false,
  createdAt: video.createdAt,
});

const buildSavedAudioItem = (req, recording) => ({
  _id: recording._id,
  id: String(recording._id),
  targetType: 'audio',
  title: recording.title || 'Sans titre',
  description:
    recording.description ||
    `${recording.title || 'Enregistrement'} - ${recording.artist || recording.user?.username || 'Artiste'}`,
  videoUrl: toPublicMediaUrl(req, recording.audioUrl),
  thumbnailUrl: recording.coverImageUrl
    ? toPublicMediaUrl(req, recording.coverImageUrl)
    : toPublicMediaUrl(req, '/public/assets/gomde-logo.png'),
  user: compactFavoriteUser(recording.user),
  likes: Array.isArray(recording.likes) ? recording.likes : [],
  comments: Array.isArray(recording.comments)
    ? recording.comments.map((comment) => ({
        ...comment,
        _id: comment._id,
        user: compactCommentUser(comment.user),
      }))
    : [],
  shares: Number(recording.shares || 0),
  views: Number(recording.plays || 0),
  type: 'audio',
  primaryCategory: recording.primaryCategory || null,
  categories: Array.isArray(recording.categories) ? recording.categories : [],
  isAudio: true,
  sourceType: 'gomdezik',
  createdAt: recording.createdAt,
});

const buildSavedContentFeed = async (req, savedContent = []) => {
  const orderedEntries = Array.isArray(savedContent)
    ? [...savedContent]
        .filter((entry) => entry?.targetType && entry?.targetId)
        .sort((left, right) => new Date(right.savedAt).getTime() - new Date(left.savedAt).getTime())
    : [];

  const videoIds = orderedEntries
    .filter((entry) => entry.targetType === 'video')
    .map((entry) => entry.targetId);
  const audioIds = orderedEntries
    .filter((entry) => entry.targetType === 'audio')
    .map((entry) => entry.targetId);

  const [videos, recordings] = await Promise.all([
    videoIds.length
      ? Video.find({ _id: { $in: videoIds }, isPublished: true })
          .populate('user', 'username primaryDiscipline profile.avatar profile.city profile.region')
          .populate('comments.user', 'username profile.avatar')
          .lean()
      : [],
    audioIds.length
      ? AudioTrack.find({
          _id: { $in: audioIds },
          instrumental: false,
          shareToCommunity: true,
          isPublic: true,
        })
          .populate('user', 'username primaryDiscipline profile.avatar profile.city profile.region')
          .populate('comments.user', 'username profile.avatar')
          .lean()
      : [],
  ]);

  const videosById = new Map(videos.map((video) => [String(video._id), buildSavedVideoItem(req, video)]));
  const recordingsById = new Map(
    recordings.map((recording) => [String(recording._id), buildSavedAudioItem(req, recording)])
  );

  return orderedEntries
    .map((entry) => {
      const key = String(entry.targetId);
      const item = entry.targetType === 'audio'
        ? recordingsById.get(key)
        : videosById.get(key);

      if (!item) {
        return null;
      }

      return {
        ...item,
        savedAt: entry.savedAt,
      };
    })
    .filter(Boolean);
};

const normalizeSavedContentEntries = (rawEntries) => {
  if (!Array.isArray(rawEntries)) {
    return [];
  }

  const seen = new Set();
  return rawEntries
    .map((entry) => {
      const rawType = typeof entry?.targetType === 'string' ? entry.targetType.trim().toLowerCase() : '';
      const targetType = rawType === 'audio' ? 'audio' : rawType === 'video' ? 'video' : '';
      const targetId = typeof entry?.targetId === 'string' ? entry.targetId.trim() : '';

      if (!targetType || !targetId || !mongoose.Types.ObjectId.isValid(targetId)) {
        return null;
      }

      const dedupeKey = `${targetType}:${targetId}`;
      if (seen.has(dedupeKey)) {
        return null;
      }
      seen.add(dedupeKey);

      return { targetType, targetId };
    })
    .filter(Boolean);
};

router.get('/', protect, buildRouteCache({ ttlMs: 10000 }), async (req, res) => {
  try {
    const { page = 1, limit = 20, role, city, search } = req.query;
    const query = { isActive: true };

    if (role) query.role = role;
    if (city) query['profile.city'] = city;
    if (search) {
      const safe = search.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&');
      query.$or = [
        { username: { $regex: safe, $options: 'i' } },
        { 'profile.city': { $regex: safe, $options: 'i' } },
        { 'profile.neighborhood': { $regex: safe, $options: 'i' } }
      ];
    }

    const users = await User.find(query)
      .select('-password')
      .sort({ 'stats.score': -1, createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await User.countDocuments(query);

    res.json({
      users,
      totalPages: Math.ceil(total / limit),
      currentPage: Number(page),
      total
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/leaderboard', protect, buildRouteCache({ ttlMs: 15000 }), async (req, res) => {
  try {
    const {
      scope = 'national',
      city,
      neighborhood,
      region,
      category,
      page = 1,
      limit = 50,
    } = req.query;

    const normalizedScope = ['national', 'region', 'city', 'neighborhood'].includes(scope)
      ? scope
      : 'national';

    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 50));
    const safePage = Math.max(1, Number(page) || 1);
    const normalizedCategory = buildDisciplinePayload(category, { fallback: [] }).categories[0] || null;

    const users = await User.find({
      isActive: true,
      role: { $ne: 'admin' },
      ...(normalizedCategory ? { disciplines: normalizedCategory } : {}),
    })
      .select('-password')
      .lean(false);

    const filteredUsers = users.filter((user) => {
      const profile = user.profile || {};
      const userCity = normalizeLocationKey(profile.city);
      const userNeighborhood = normalizeLocationKey(profile.neighborhood);
      const userRegion = normalizeLocationKey(safeResolveUserRegion(user));

      if (normalizedScope === 'city') {
        return city ? userCity === normalizeLocationKey(city) : !!userCity;
      }

      if (normalizedScope === 'neighborhood') {
        if (!neighborhood) {
          return false;
        }

        const matchesNeighborhood = userNeighborhood === normalizeLocationKey(neighborhood);
        if (!city) {
          return matchesNeighborhood;
        }

        return matchesNeighborhood && userCity === normalizeLocationKey(city);
      }

      if (normalizedScope === 'region') {
        return region ? userRegion === normalizeLocationKey(region) : !!userRegion;
      }

      return true;
    });

    filteredUsers.sort((left, right) => {
      const leftScore = calculateOfficialScore(left?.stats);
      const rightScore = calculateOfficialScore(right?.stats);
      if (rightScore !== leftScore) return rightScore - leftScore;

      const leftWins = Number(left?.stats?.battles?.wins || 0);
      const rightWins = Number(right?.stats?.battles?.wins || 0);
      if (rightWins !== leftWins) return rightWins - leftWins;

      const leftViews = Number(left?.stats?.totalViews || 0);
      const rightViews = Number(right?.stats?.totalViews || 0);
      if (rightViews !== leftViews) return rightViews - leftViews;

      return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    });

    const rankedUsers = filteredUsers.map((user, index) => buildLeaderboardRow(user, index + 1));
    const pagedUsers = rankedUsers.slice((safePage - 1) * safeLimit, safePage * safeLimit);
    const championLevel = normalizedScope === 'neighborhood'
      ? 'sector'
      : normalizedScope === 'region'
      ? 'regional'
      : 'national';
    const championUser = filteredUsers[0] || null;
    const champion = normalizedCategory && championUser
      ? await getChampionForLeaderboard({
          category: normalizedCategory,
          level: championLevel,
          user: championUser,
        })
      : null;

    res.json({
      scope: normalizedScope,
      category: normalizedCategory,
      champion,
      users: pagedUsers,
      total: rankedUsers.length,
      currentPage: safePage,
      totalPages: Math.max(1, Math.ceil(rankedUsers.length / safeLimit)),
      filters: {
        city: city || null,
        neighborhood: neighborhood || null,
        region: region || null,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/me/favorites', protect, buildRouteCache({ ttlMs: 5000 }), async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('savedContent');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const items = await buildSavedContentFeed(req, user.savedContent);

    res.json({ items, total: items.length });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/me/favorites/toggle', protect, favoritesLimiter, async (req, res) => {
  try {
    const rawType = typeof req.body?.targetType === 'string' ? req.body.targetType.trim().toLowerCase() : '';
    const targetType = rawType === 'audio' ? 'audio' : rawType === 'video' ? 'video' : '';
    const targetId = typeof req.body?.targetId === 'string' ? req.body.targetId.trim() : '';

    if (!targetType || !targetId) {
      return res.status(400).json({ message: 'targetType and targetId are required' });
    }

    if (!mongoose.Types.ObjectId.isValid(targetId)) {
      return res.status(400).json({ message: 'Invalid targetId' });
    }

    const targetExists = targetType === 'audio'
      ? await AudioTrack.exists({
          _id: targetId,
          instrumental: false,
          shareToCommunity: true,
          isPublic: true,
        })
      : await Video.exists({ _id: targetId, isPublished: true });

    if (!targetExists) {
      return res.status(404).json({ message: 'Content not found' });
    }

    const user = await User.findById(req.user._id).select('savedContent');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const existingIndex = user.savedContent.findIndex(
      (entry) => entry.targetType === targetType && String(entry.targetId) === targetId
    );

    let saved = false;
    if (existingIndex >= 0) {
      user.savedContent.splice(existingIndex, 1);
    } else {
      user.savedContent.unshift({ targetType, targetId });
      saved = true;
    }

    await user.save();

    const items = await buildSavedContentFeed(req, user.savedContent);

    res.json({ saved, total: items.length, items });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/me/favorites/import', protect, favoritesLimiter, async (req, res) => {
  try {
    const normalizedEntries = normalizeSavedContentEntries(req.body?.items);
    const user = await User.findById(req.user._id).select('savedContent');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (!normalizedEntries.length) {
      const items = await buildSavedContentFeed(req, user.savedContent);
      return res.json({ importedCount: 0, total: items.length, items });
    }

    const videoIds = normalizedEntries
      .filter((entry) => entry.targetType === 'video')
      .map((entry) => entry.targetId);
    const audioIds = normalizedEntries
      .filter((entry) => entry.targetType === 'audio')
      .map((entry) => entry.targetId);

    const [validVideos, validAudios] = await Promise.all([
      videoIds.length
        ? Video.find({ _id: { $in: videoIds }, isPublished: true }).select('_id').lean()
        : [],
      audioIds.length
        ? AudioTrack.find({
            _id: { $in: audioIds },
            instrumental: false,
            shareToCommunity: true,
            isPublic: true,
          })
            .select('_id')
            .lean()
        : [],
    ]);

    const validKeys = new Set([
      ...validVideos.map((entry) => `video:${String(entry._id)}`),
      ...validAudios.map((entry) => `audio:${String(entry._id)}`),
    ]);
    const existingKeys = new Set(
      (user.savedContent || []).map(
        (entry) => `${entry.targetType}:${String(entry.targetId)}`
      )
    );

    let importedCount = 0;
    for (const entry of normalizedEntries) {
      const key = `${entry.targetType}:${entry.targetId}`;
      if (!validKeys.has(key) || existingKeys.has(key)) {
        continue;
      }

      user.savedContent.unshift(entry);
      existingKeys.add(key);
      importedCount += 1;
    }

    if (importedCount > 0) {
      await user.save();
    }

    const items = await buildSavedContentFeed(req, user.savedContent);
    res.json({ importedCount, total: items.length, items });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/:id', protect, buildRouteCache({ ttlMs: 10000 }), async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('-password')
      .populate('stats.followers', 'username profile.avatar')
      .populate('stats.following', 'username profile.avatar');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    res.json(user);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/:id/follow', protect, followLimiter, async (req, res) => {
  try {
    const userToFollow = await User.findById(req.params.id);
    const currentUser = await User.findById(req.user._id);
    
    if (!userToFollow) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    if (userToFollow._id.toString() === currentUser._id.toString()) {
      return res.status(400).json({ message: 'Cannot follow yourself' });
    }
    
    const isFollowing = currentUser.stats.following.includes(userToFollow._id);
    
    if (isFollowing) {
      currentUser.stats.following = currentUser.stats.following.filter(
        id => id.toString() !== userToFollow._id.toString()
      );
      userToFollow.stats.followers = userToFollow.stats.followers.filter(
        id => id.toString() !== currentUser._id.toString()
      );
    } else {
      currentUser.stats.following.push(userToFollow._id);
      userToFollow.stats.followers.push(currentUser._id);
    }
    
    await currentUser.save();
    await userToFollow.save();
    
    res.json({ following: !isFollowing });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;