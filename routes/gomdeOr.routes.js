const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  getEdition,
  getLeaderboard,
  getMyEntry,
  register,
  getProvinceResults,
  getTrophies,
} = require('../controllers/gomdeOr.controller');

// Public
router.get('/', getEdition);
router.get('/leaderboard', getLeaderboard);
router.get('/province-results', getProvinceResults);
router.get('/trophies', getTrophies);

// Authenticated
router.get('/my-entry', protect, getMyEntry);
router.post('/register', protect, register);

module.exports = router;
