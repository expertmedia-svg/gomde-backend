const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure upload directories exist
const ensureUploadDirs = () => {
  const videoDir = path.join(__dirname, '..', 'uploads', 'videos');
  const audioDir = path.join(__dirname, '..', 'uploads', 'audio');
  const thumbDir = path.join(__dirname, '..', 'uploads', 'thumbnails');
  const coverDir = path.join(__dirname, '..', 'uploads', 'covers');
  
  [videoDir, audioDir, thumbDir, coverDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`Created upload directory: ${dir}`);
    }
  });
};

ensureUploadDirs();

const AUDIO_EXTENSION_BY_MIME = {
  'audio/aac': '.aac',
  'audio/mp3': '.mp3',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/m4a': '.m4a',
  'audio/ogg': '.ogg',
  'audio/wav': '.wav',
  'audio/wave': '.wav',
  'audio/webm': '.webm',
  'audio/x-m4a': '.m4a',
  'audio/x-wav': '.wav',
  'audio/x-wave': '.wav'
};

const AUDIO_ALLOWED_EXTENSIONS = new Set([
  '.aac',
  '.m4a',
  '.mp3',
  '.ogg',
  '.wav',
  '.webm'
]);

const resolveAudioExtension = (file) => {
  const originalExtension = path.extname(file.originalname || '').toLowerCase();
  if (AUDIO_ALLOWED_EXTENSIONS.has(originalExtension)) {
    return originalExtension;
  }

  return AUDIO_EXTENSION_BY_MIME[file.mimetype] || '.bin';
};

const videoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '..', 'uploads', 'videos');
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const extension = path.extname(file.originalname || '').toLowerCase() || '.mp4';
    cb(null, uniqueSuffix + extension);
  }
});

const audioStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '..', 'uploads', 'audio');
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + resolveAudioExtension(file));
  }
});

const imageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '..', 'uploads', 'covers');
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
    cb(null, uniqueSuffix + ext);
  }
});

const videoFilter = (req, file, cb) => {
  const allowedTypes = new Set([
    'video/mp4',
    'video/mpeg',
    'video/quicktime',
    'video/3gpp',
    'video/3gpp2',
    'video/webm',
    'video/x-matroska'
  ]);
  if (allowedTypes.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type'), false);
  }
};

const audioFilter = (req, file, cb) => {
  const extension = path.extname(file.originalname || '').toLowerCase();
  const allowedTypes = new Set([
    'application/octet-stream',
    'audio/aac',
    'audio/mp3',
    'audio/mpeg',
    'audio/mp4',
    'audio/m4a',
    'audio/ogg',
    'audio/wav',
    'audio/wave',
    'audio/webm',
    'audio/x-m4a',
    'audio/x-wav',
    'audio/x-wave'
  ]);

  if (allowedTypes.has(file.mimetype) || AUDIO_ALLOWED_EXTENSIONS.has(extension)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid audio type'), false);
  }
};

const imageFilter = (req, file, cb) => {
  const allowedTypes = new Set([
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/gif'
  ]);
  if (allowedTypes.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid image type'), false);
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

const uploadImage = multer({ 
  storage: imageStorage, 
  fileFilter: imageFilter,
  limits: { fileSize: 5 * 1024 * 1024 }
});

const uploadProfileMedia = multer({
  storage: imageStorage,
  fileFilter: imageFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
}).fields([
  { name: 'avatar', maxCount: 1 },
  { name: 'cover', maxCount: 1 },
]);

// Middleware wrapper to log successful uploads
const logUploadSuccess = (fieldName) => (req, res, next) => {
  if (req.file) {
    const uploadPath = path.join(req.file.destination, req.file.filename);
    const fileSize = req.file.size;
    const mimeType = req.file.mimetype;
    console.log(`[Upload Success] Type: ${fieldName}, File: ${req.file.filename}, Size: ${fileSize} bytes, MIME: ${mimeType}, Path: ${uploadPath}`);
    
    // Verify file actually exists after multer write
    setTimeout(() => {
      if (fs.existsSync(uploadPath)) {
        const stat = fs.statSync(uploadPath);
        console.log(`[Upload Verified] File exists: ${uploadPath}, Actual size: ${stat.size} bytes`);
      } else {
        console.error(`[Upload Failed Verification] File not found after upload: ${uploadPath}`);
      }
    }, 100);
  }
  next();
};

const logFieldUploadSuccess = (fieldNames) => (req, res, next) => {
  fieldNames.forEach((fieldName) => {
    const file = req.files?.[fieldName]?.[0];
    if (!file) {
      return;
    }

    const uploadPath = path.join(file.destination, file.filename);
    console.log(`[Upload Success] Type: ${fieldName}, File: ${file.filename}, Size: ${file.size} bytes, MIME: ${file.mimetype}, Path: ${uploadPath}`);
  });

  next();
};

// Enhanced exports with logging middleware
module.exports = {
  uploadVideo,
  uploadAudio,
  uploadImage,
  uploadProfileMedia,
  uploadVideoWithLogging: [uploadVideo.single('video'), logUploadSuccess('video')],
  uploadAudioWithLogging: [uploadAudio.single('audio'), logUploadSuccess('audio')],
  uploadImageWithLogging: [uploadImage.single('cover'), logUploadSuccess('cover')],
  uploadProfileMediaWithLogging: [uploadProfileMedia, logFieldUploadSuccess(['avatar', 'cover'])],
};