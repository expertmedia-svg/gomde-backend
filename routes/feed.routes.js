const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  getSmartFeed,
  getTrending,
  getLocalContent,
  getGomdezik
} = require('../controllers/feed.controller');

router.get('/smart', protect, getSmartFeed);
router.get('/trending', getTrending);
router.get('/local', protect, getLocalContent);
router.get('/gomde-zik', protect, getGomdezik);

module.exports = router;