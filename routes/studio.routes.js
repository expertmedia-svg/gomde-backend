const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { protect, admin } = require('../middleware/auth');
const multer = require('multer');
const { uploadImageWithLogging } = require('../middleware/upload');
const {
  getInstrumentals,
  saveAudioRecording,
  getUserRecordings,
  uploadInstrumental,
  getCommunityRecordings,
  publishRecording
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

router.get('/instrumentals', getInstrumentals);
router.get('/community-recordings', getCommunityRecordings);
router.post('/instrumentals', protect, admin, audioUpload.single('audio'), uploadInstrumental);
router.post('/record', protect, recordingUpload, saveAudioRecording);
router.get('/my-recordings', protect, getUserRecordings);
router.post('/recordings/:id/publish', protect, uploadImageWithLogging, publishRecording);

module.exports = router;