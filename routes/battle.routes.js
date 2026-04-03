const express = require('express');
const router = express.Router();
const { protect, artist } = require('../middleware/auth');
const { uploadVideo } = require('../middleware/upload');
const {
  createBattle,
  getBattles,
  getBattleById,
  joinBattle,
  submitEntry,
  vote,
  likeBattle
} = require('../controllers/battle.controller');

router.post('/', protect, artist, createBattle);
router.get('/', getBattles);
router.get('/:id', getBattleById);
router.post('/:id/join', protect, joinBattle);
router.post('/:id/submit', protect, uploadVideo.single('video'), submitEntry);
router.post('/:id/vote', protect, vote);
router.post('/:id/like', protect, likeBattle);

module.exports = router;