const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { protect } = require('../middleware/auth');
const { uploadVideo } = require('../middleware/upload');
const {
  uploadVideo: handleUploadVideo,
  getVideos,
  getVideoById,
  incrementVideoView,
  likeVideo,
  commentVideo,
  shareVideo
} = require('../controllers/video.controller');

// Rate limit for view increment: 5 per minute per IP per video
const viewLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  keyGenerator: (req) => `${req.ip}-${req.params.id}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many view requests' }
});

router.post('/upload', protect, uploadVideo.single('video'), handleUploadVideo);
router.post('/create', protect, uploadVideo.single('video'), handleUploadVideo);
router.get('/', getVideos);
router.get('/:id', getVideoById);
router.post('/:id/view', viewLimiter, incrementVideoView);
router.post('/:id/like', protect, likeVideo);
router.post('/:id/comment', protect, commentVideo);
router.post('/:id/share', protect, shareVideo);

module.exports = router;