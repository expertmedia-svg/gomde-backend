const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { buildRouteCache } = require('../middleware/cache');
const { buildActionLimiter } = require('../middleware/traffic');
const User = require('../models/user');
const {
  normalizeLocationKey,
  resolveRegionFromCity,
} = require('../services/location.service');
const { buildDisciplinePayload } = require('../constants/disciplines');
const { getChampionForLeaderboard } = require('../services/champion.service');
const { calculateOfficialScore } = require('../services/score.service');

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