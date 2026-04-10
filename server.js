const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const crypto = require('crypto');
const dotenv = require('dotenv');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

dotenv.config({ path: path.join(__dirname, '.env') });

// ── Validate required environment variables ──────────────────────────
const requiredEnvVars = ['MONGODB_URI', 'JWT_SECRET', 'FRONTEND_URL'];
const missingEnvVars = requiredEnvVars.filter(v => !process.env[v]);
if (missingEnvVars.length > 0) {
  console.error(`FATAL: Missing required environment variables: ${missingEnvVars.join(', ')}`);
  process.exit(1);
}

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

  if (process.env.NODE_ENV !== 'production' && localhostOriginPattern.test(origin)) {
    return true;
  }

  return allowedOrigins.length > 0 && allowedOrigins.includes(origin);
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
app.set('trust proxy', 1);

const rateLimit = require('express-rate-limit');

// Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(compression());
app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Global rate limiter — keyed by bearer token when available, fallback to IP.
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 1200,
  keyGenerator: (req) => {
    const authHeader = req.get('authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return `bearer:${crypto
        .createHash('sha1')
        .update(authHeader.slice(7))
        .digest('hex')}`;
    }
    return req.ip;
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests, please try again later.' }
});
app.use('/api', globalLimiter);

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
app.use('/uploads/thumbnails', express.static(path.join(__dirname, 'uploads', 'thumbnails'), {
  setHeaders: (res, filePath) => {
    res.setHeader('Cache-Control', 'public, max-age=7200');
    const ext = filePath.toLowerCase();
    if (ext.endsWith('.jpg') || ext.endsWith('.jpeg')) {
      res.setHeader('Content-Type', 'image/jpeg');
    } else if (ext.endsWith('.png')) {
      res.setHeader('Content-Type', 'image/png');
    } else if (ext.endsWith('.webp')) {
      res.setHeader('Content-Type', 'image/webp');
    }
    res.setHeader('Content-Disposition', `inline; filename="${toSafeHeaderFilename(filePath)}"`);
  },
  onError: (err, req, res) => {
    console.error(`[Thumbnail Serve Error] Path: ${req.path}, Error: ${err.message}`);
    res.status(500).json({ error: 'Failed to serve thumbnail' });
  }
}));
app.use('/uploads/videos', express.static(path.join(__dirname, 'uploads', 'videos'), {
  acceptRanges: true,
  setHeaders: (res, filePath) => {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    if (filePath.endsWith('.mp4')) {
      res.setHeader('Content-Type', 'video/mp4');
    } else if (filePath.endsWith('.webm')) {
      res.setHeader('Content-Type', 'video/webm');
    }
  },
  onError: (err, req, res) => {
    console.error(`[Video Serve Error] Path: ${req.path}, Error: ${err.message}`);
    res.status(500).json({ error: 'Failed to serve video' });
  }
}));
app.use('/uploads/audio', express.static(path.join(__dirname, 'uploads', 'audio'), {
  setHeaders: (res, filePath) => {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    const ext = filePath.toLowerCase();
    if (ext.endsWith('.m4a')) {
      res.setHeader('Content-Type', 'audio/mp4');
    } else if (ext.endsWith('.mp3')) {
      res.setHeader('Content-Type', 'audio/mpeg');
    } else if (ext.endsWith('.wav')) {
      res.setHeader('Content-Type', 'audio/wav');
    } else if (ext.endsWith('.webm')) {
      res.setHeader('Content-Type', 'audio/webm');
    } else if (ext.endsWith('.aac')) {
      res.setHeader('Content-Type', 'audio/aac');
    } else if (ext.endsWith('.ogg')) {
      res.setHeader('Content-Type', 'audio/ogg');
    }
    res.setHeader('Content-Disposition', `inline; filename="${toSafeHeaderFilename(filePath)}"`);
  },
  onError: (err, req, res) => {
    console.error(`[Audio Serve Error] Path: ${req.path}, Error: ${err.message}`);
    res.status(500).json({ error: 'Failed to serve audio' });
  }
}));

app.use('/uploads/covers', express.static(path.join(__dirname, 'uploads', 'covers'), {
  setHeaders: (res, filePath) => {
    res.setHeader('Cache-Control', 'public, max-age=7200');
    const ext = filePath.toLowerCase();
    if (ext.endsWith('.jpg') || ext.endsWith('.jpeg')) {
      res.setHeader('Content-Type', 'image/jpeg');
    } else if (ext.endsWith('.png')) {
      res.setHeader('Content-Type', 'image/png');
    } else if (ext.endsWith('.webp')) {
      res.setHeader('Content-Type', 'image/webp');
    } else if (ext.endsWith('.gif')) {
      res.setHeader('Content-Type', 'image/gif');
    }
    res.setHeader('Content-Disposition', `inline; filename="${toSafeHeaderFilename(filePath)}"`);
  },
  onError: (err, req, res) => {
    console.error(`[Cover Serve Error] Path: ${req.path}, Error: ${err.message}`);
    res.status(500).json({ error: 'Failed to serve cover' });
  }
}));

// Serve public assets (logos, default images)
app.use('/public/assets', express.static(path.join(__dirname, 'public', 'assets'), {
  setHeaders: (res, filePath) => {
    res.setHeader('Cache-Control', 'public, max-age=86400');
    const ext = filePath.toLowerCase();
    if (ext.endsWith('.png')) {
      res.setHeader('Content-Type', 'image/png');
    } else if (ext.endsWith('.jpg') || ext.endsWith('.jpeg')) {
      res.setHeader('Content-Type', 'image/jpeg');
    } else if (ext.endsWith('.webp')) {
      res.setHeader('Content-Type', 'image/webp');
    }
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
const gomdeOrRoutes = require('./routes/gomdeOr.routes');

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'GOMDE API is running', version: '1.0.0' });
});

// Debug endpoints — admin only in production
const { protect: debugProtect, admin: debugAdmin } = require('./middleware/auth');

app.get('/api/health/uploads', debugProtect, debugAdmin, (req, res) => {
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
app.get('/api/debug/videos', debugProtect, debugAdmin, (req, res) => {
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
app.get('/api/debug/video-exists/:filename', debugProtect, debugAdmin, (req, res) => {
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
app.use('/api/gomde-or', gomdeOrRoutes);

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

// MongoDB connection with pool config
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  maxPoolSize: 10,
  minPoolSize: 2,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
})
.then(() => console.log('MongoDB connected successfully'))
.catch((err) => {
  console.error('MongoDB connection error:', err);
  process.exit(1);
});

mongoose.connection.on('error', (err) => {
  console.error('MongoDB runtime error:', err);
});

mongoose.connection.on('disconnected', () => {
  console.warn('MongoDB disconnected');
});

// Health check with DB status
app.get('/api/health', (req, res) => {
  const dbState = mongoose.connection.readyState;
  const dbStatus = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };
  res.status(dbState === 1 ? 200 : 503).json({
    status: dbState === 1 ? 'ok' : 'degraded',
    db: dbStatus[dbState] || 'unknown',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);

  // Auto-close expired battles every minute
  const { closeExpiredBattles } = require('./controllers/battle.controller');
  setInterval(async () => {
    try {
      const result = await closeExpiredBattles();
      if (result.forfeited > 0 || result.completed > 0) {
        console.log(`[Battle Cron] forfeited=${result.forfeited}, completed=${result.completed}`);
      }
    } catch (err) {
      console.error('[Battle Cron] Error:', err.message);
    }
  }, 60 * 1000);
});

// Graceful shutdown
const gracefulShutdown = (signal) => {
  console.log(`${signal} received. Shutting down gracefully...`);
  server.close(() => {
    console.log('HTTP server closed');
    mongoose.connection.close(false).then(() => {
      console.log('MongoDB connection closed');
      process.exit(0);
    });
  });
  // Force close after 10s
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Catch unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

module.exports = { app, io };