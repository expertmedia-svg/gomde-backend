const multer = require('multer');
const path = require('path');

const videoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/videos/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const audioStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/audio/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '.webm');
  }
});

const videoFilter = (req, file, cb) => {
  const allowedTypes = ['video/mp4', 'video/mpeg', 'video/quicktime'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type'), false);
  }
};

const audioFilter = (req, file, cb) => {
  const allowedTypes = ['audio/webm', 'audio/mp3', 'audio/wav'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid audio type'), false);
  }
};

const uploadVideo = multer({ 
  storage: videoStorage, 
  fileFilter: videoFilter,
  limits: { fileSize: 100 * 1024 * 1024 }
});

const uploadAudio = multer({ 
  storage: audioStorage, 
  fileFilter: audioFilter,
  limits: { fileSize: 50 * 1024 * 1024 }
});

module.exports = { uploadVideo, uploadAudio };