const express = require('express');
const router = express.Router();
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

router.post('/upload', protect, uploadVideo.single('video'), handleUploadVideo);
router.post('/create', protect, uploadVideo.single('video'), handleUploadVideo);
router.get('/', getVideos);
router.get('/:id', getVideoById);
router.post('/:id/view', incrementVideoView);
router.post('/:id/like', protect, likeVideo);
router.post('/:id/comment', protect, commentVideo);
router.post('/:id/share', protect, shareVideo);

module.exports = router;