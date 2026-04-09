const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { uploadVideo } = require('../middleware/upload');
const {
  createBattle,
  getBattles,
  getBattleById,
  getMyChallenges,
  acceptChallenge,
  refuseChallenge,
  joinBattle,
  submitEntry,
  vote,
  likeBattle
} = require('../controllers/battle.controller');

router.post('/', protect, createBattle);
router.get('/', getBattles);
router.get('/challenges', protect, getMyChallenges);
router.get('/:id', getBattleById);
router.post('/:id/accept', protect, acceptChallenge);
router.post('/:id/refuse', protect, refuseChallenge);
router.post('/:id/join', protect, joinBattle);
router.post('/:id/submit', protect, uploadVideo.single('video'), submitEntry);
router.post('/:id/vote', protect, vote);
router.post('/:id/like', protect, likeBattle);

module.exports = router;