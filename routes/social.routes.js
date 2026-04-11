const express = require('express');
const { protect } = require('../middleware/auth');
const { buildRouteCache } = require('../middleware/cache');
const { buildActionLimiter } = require('../middleware/traffic');
const {
  comment,
  createStatus,
  getFollowingFeed,
  getPostById,
  getWall,
  shareToWall,
  toggleLike,
} = require('../controllers/social.controller');

const router = express.Router();

const postWriteLimiter = buildActionLimiter({
  windowMs: 10 * 60 * 1000,
  max: 20,
  prefix: 'social-write',
});

const postActionLimiter = buildActionLimiter({
  windowMs: 60 * 1000,
  max: 40,
  prefix: 'social-action',
  paramName: 'id',
});

router.get('/wall/:userId', protect, buildRouteCache({ ttlMs: 12000 }), getWall);
router.get('/feed/following', protect, buildRouteCache({ ttlMs: 10000 }), getFollowingFeed);
router.get('/posts/:id', protect, buildRouteCache({ ttlMs: 5000 }), getPostById);
router.post('/posts/status', protect, postWriteLimiter, createStatus);
router.post('/posts/share', protect, postWriteLimiter, shareToWall);
router.post('/posts/:id/like', protect, postActionLimiter, toggleLike);
router.post('/posts/:id/comment', protect, postActionLimiter, comment);

module.exports = router;