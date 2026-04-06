const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const dotenv = require('dotenv');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

dotenv.config({ path: path.join(__dirname, '.env') });

const allowedOrigins = (process.env.FRONTEND_URL || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const localhostOriginPattern = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

const toSafeHeaderFilename = (filePath) => {
  const originalName = path.basename(filePath);

  return originalName
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/["\\;]/g, '_')
    .trim() || 'file';
};

const isAllowedOrigin = (origin) => {
  if (!origin) {
    return true;
  }

  if (localhostOriginPattern.test(origin)) {
    return true;
  }

  return allowedOrigins.length === 0 || allowedOrigins.includes(origin);
};

const app = express();
const corsOptions = {
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  optionsSuccessStatus: 204
};

const server = http.createServer(app);
const io = new Server(server, {
  cors: corsOptions
});
app.set('io', io);

// Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(compression());
app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(morgan('dev'));

// Ensure upload directories exist
const uploadDirs = [
  path.join(__dirname, 'uploads'),
  path.join(__dirname, 'uploads', 'videos'),
  path.join(__dirname, 'uploads', 'audio'),
  path.join(__dirname, 'uploads', 'thumbnails'),
  path.join(__dirname, 'uploads', 'instru'),
];
uploadDirs.forEach(dir => {
  try {
    if (!require('fs').existsSync(dir)) {
      require('fs').mkdirSync(dir, { recursive: true });
      console.log(`✓ Created upload directory: ${dir}`);
    }
  } catch (err) {
    console.error(`Error creating upload directory ${dir}:`, err.message);
  }
});

app.use('/uploads/instru', express.static(path.join(__dirname, 'uploads', 'instru'), {
  setHeaders: (res, filePath) => {
    res.setHeader('Content-Disposition', `inline; filename="${toSafeHeaderFilename(filePath)}"`);
    res.setHeader('Cache-Control', 'public, max-age=3600');
  }
}));
app.use('/uploads/videos', express.static(path.join(__dirname, 'uploads', 'videos'), {
  acceptRanges: true,
  setHeaders: (res, filePath) => {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    if (filePath.endsWith('.mp4')) {
      res.setHeader('Content-Type', 'video/mp4');
    }
  },
  onError: (err, req, res) => {
    console.error(`[Video Serve Error] Path: ${req.path}, Error: ${err.message}`);
    res.status(500).json({ error: 'Failed to serve video' });
  }
}));

// Middleware pour capturer les 404 sur les vidéos (video non trouvée)
app.use((req, res, next) => {
  if (req.path.startsWith('/uploads/videos/') && res.statusCode === 404) {
    const videoPath = path.join(__dirname, 'uploads', 'videos', req.path.split('/uploads/videos/')[1]);
    const exists = fs.existsSync(videoPath);
    console.warn(`[Video 404] Requested: ${req.path}, File exists on disk: ${exists}, Full path: ${videoPath}`);
  }
  next();
});

// Import routes
const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const battleRoutes = require('./routes/battle.routes');
const videoRoutes = require('./routes/video.routes');
const feedRoutes = require('./routes/feed.routes');
const adminRoutes = require('./routes/admin.routes');
const studioRoutes = require('./routes/studio.routes');
const liveRoutes = require('./routes/live.routes');

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'GOMDE API is running', version: '1.0.0' });
});

// Debug endpoint: Check upload directories
app.get('/api/health/uploads', (req, res) => {
  const uploadDirs = {
    videos: path.join(__dirname, 'uploads', 'videos'),
    audio: path.join(__dirname, 'uploads', 'audio'),
    thumbnails: path.join(__dirname, 'uploads', 'thumbnails'),
    instru: path.join(__dirname, 'uploads', 'instru'),
  };

  const status = {};
  for (const [key, dir] of Object.entries(uploadDirs)) {
    try {
      const exists = fs.existsSync(dir);
      const stats = exists ? fs.statSync(dir) : null;
      const files = exists ? fs.readdirSync(dir) : [];
      const totalSize = files.reduce((sum, f) => {
        try {
          return sum + fs.statSync(path.join(dir, f)).size;
        } catch (e) {
          return sum;
        }
      }, 0);

      status[key] = {
        exists,
        path: dir,
        fileCount: files.length,
        sampleFiles: files.slice(0, 5),
        totalSize,
        writable: exists && (fs.accessSync(dir, fs.constants.W_OK) || true) && true,
        lastModified: stats ? stats.mtime : null
      };
    } catch (err) {
      status[key] = {
        exists: false,
        error: err.message,
        path: dir
      };
    }
  }

  res.json({
    uploadDirs: status,
    env: process.env.NODE_ENV,
    timestamp: new Date().toISOString(),
    serverRoot: __dirname
  });
});

// Debug endpoint: List available videos
app.get('/api/debug/videos', (req, res) => {
  const videoDir = path.join(__dirname, 'uploads', 'videos');
  try {
    if (!fs.existsSync(videoDir)) {
      return res.status(404).json({ error: 'Videos directory not found', path: videoDir });
    }
    const videos = fs.readdirSync(videoDir).map(file => {
      const filePath = path.join(videoDir, file);
      const stat = fs.statSync(filePath);
      return {
        name: file,
        size: stat.size,
        created: stat.birthtime,
        modified: stat.mtime,
        accessible: true
      };
    });
    res.json({
      videoDir,
      count: videos.length,
      videos: videos.sort((a, b) => b.modified - a.modified)
    });
  } catch (err) {
    res.status(500).json({ error: err.message, videoDir });
  }
});

// Debug endpoint: Check if specific video exists
app.get('/api/debug/video-exists/:filename', (req, res) => {
  const filename = req.params.filename;
  const videoPath = path.join(__dirname, 'uploads', 'videos', filename);
  
  // Security: Prevent directory traversal
  if (!videoPath.startsWith(path.join(__dirname, 'uploads', 'videos'))) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  
  try {
    const exists = fs.existsSync(videoPath);
    const details = {};
    
    if (exists) {
      const stat = fs.statSync(videoPath);
      details.stat = {
        size: stat.size,
        created: stat.birthtime,
        modified: stat.mtime,
        isFile: stat.isFile(),
        isDirectory: stat.isDirectory()
      };
      details.accessible = true;
    }
    
    res.json({
      filename,
      exists,
      path: videoPath,
      ...details
    });
  } catch (err) {
    res.status(500).json({ error: err.message, filename });
  }
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/battles', battleRoutes);
app.use('/api/videos', videoRoutes);
app.use('/api/feed', feedRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/studio', studioRoutes);
app.use('/api/live', liveRoutes);

// Socket.io for live battles
require('./sockets/liveBattle.socket')(io);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    message: err.message || 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err : {}
  });
});

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('MongoDB connected successfully'))
.catch((err) => console.error('MongoDB connection error:', err));

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = { app, io };