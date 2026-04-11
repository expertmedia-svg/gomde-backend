const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { protect } = require('../middleware/auth');
const { buildRouteCache } = require('../middleware/cache');
const { buildActionLimiter } = require('../middleware/traffic');
const { uploadVideo } = require('../middleware/upload');
const {
  uploadVideo: handleUploadVideo,
  getVideos,
  getVideoById,
  incrementVideoView,
  likeVideo,
  commentVideo,
  shareVideo,
  deleteVideo
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

const uploadLimiter = buildActionLimiter({
  windowMs: 10 * 60 * 1000,
  max: 25,
  prefix: 'video-upload',
  message: 'Too many uploads, please wait before sending another clip.',
});

const engagementLimiter = buildActionLimiter({
  windowMs: 60 * 1000,
  max: 40,
  prefix: 'video-engagement',
  paramName: 'id',
});

router.post('/upload', protect, uploadLimiter, uploadVideo.single('video'), handleUploadVideo);
router.post('/create', protect, uploadLimiter, uploadVideo.single('video'), handleUploadVideo);
router.get('/', buildRouteCache({ ttlMs: 10000 }), getVideos);
router.get('/:id', getVideoById);
router.post('/:id/view', viewLimiter, incrementVideoView);
router.post('/:id/like', protect, engagementLimiter, likeVideo);
router.post('/:id/comment', protect, engagementLimiter, commentVideo);
router.post('/:id/share', protect, engagementLimiter, shareVideo);
router.delete('/:id', protect, deleteVideo);

module.exports = router;