const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { protect, admin } = require('../middleware/auth');
const multer = require('multer');
const { buildRouteCache } = require('../middleware/cache');
const { buildActionLimiter } = require('../middleware/traffic');
const { uploadImageWithLogging } = require('../middleware/upload');
const {
  getInstrumentals,
  saveAudioRecording,
  getUserRecordings,
  uploadInstrumental,
  getCommunityRecordings,
  publishRecording,
  incrementRecordingPlay,
  toggleRecordingLike,
  commentRecording,
  shareRecording,
  deleteRecording
} = require('../controllers/studio.controller');

// Ensure upload directory exists
const audioUploadDir = path.join(__dirname, '..', 'uploads', 'audio');
if (!fs.existsSync(audioUploadDir)) {
  fs.mkdirSync(audioUploadDir, { recursive: true });
}

const audioStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, audioUploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const extension = file.originalname && file.originalname.includes('.')
      ? file.originalname.slice(file.originalname.lastIndexOf('.'))
      : '.webm';
    cb(null, uniqueSuffix + extension.toLowerCase());
  }
});

const audioUpload = multer({ 
  storage: audioStorage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

const recordingUpload = audioUpload.fields([
  { name: 'audio', maxCount: 1 },
  { name: 'rawVoice', maxCount: 1 }
]);

const studioUploadLimiter = buildActionLimiter({
  windowMs: 10 * 60 * 1000,
  max: 25,
  prefix: 'studio-upload',
});

const studioActionLimiter = buildActionLimiter({
  windowMs: 60 * 1000,
  max: 50,
  prefix: 'studio-action',
  paramName: 'id',
});

router.get('/instrumentals', getInstrumentals);
router.get('/community-recordings', buildRouteCache({ ttlMs: 12000 }), getCommunityRecordings);
router.post('/instrumentals', protect, admin, audioUpload.single('audio'), uploadInstrumental);
router.post('/record', protect, studioUploadLimiter, recordingUpload, saveAudioRecording);
router.get('/my-recordings', protect, getUserRecordings);
router.post('/recordings/:id/publish', protect, studioActionLimiter, uploadImageWithLogging, publishRecording);
router.post('/recordings/:id/play', protect, studioActionLimiter, incrementRecordingPlay);
router.post('/recordings/:id/like', protect, studioActionLimiter, toggleRecordingLike);
router.post('/recordings/:id/comment', protect, studioActionLimiter, commentRecording);
router.post('/recordings/:id/share', protect, studioActionLimiter, shareRecording);
router.delete('/recordings/:id', protect, deleteRecording);

module.exports = router;