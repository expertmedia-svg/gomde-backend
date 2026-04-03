const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  getSmartFeed,
  getTrending,
  getLocalContent
} = require('../controllers/feed.controller');

router.get('/smart', protect, getSmartFeed);
router.get('/trending', getTrending);
router.get('/local', protect, getLocalContent);

module.exports = router;