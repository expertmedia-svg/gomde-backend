const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { buildRouteCache } = require('../middleware/cache');
const {
  getSmartFeed,
  getTrending,
  getLocalContent,
  getGomdezik
} = require('../controllers/feed.controller');

router.get('/smart', protect, buildRouteCache({ ttlMs: 15000 }), getSmartFeed);
router.get('/trending', buildRouteCache({ ttlMs: 15000 }), getTrending);
router.get('/local', protect, buildRouteCache({ ttlMs: 12000 }), getLocalContent);
router.get('/gomde-zik', protect, buildRouteCache({ ttlMs: 15000 }), getGomdezik);

module.exports = router;