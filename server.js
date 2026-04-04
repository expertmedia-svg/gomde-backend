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
app.use('/uploads/instru', express.static(path.join(__dirname, 'uploads', 'instru'), {
  setHeaders: (res, filePath) => {
    res.setHeader('Content-Disposition', `inline; filename="${toSafeHeaderFilename(filePath)}"`);
    res.setHeader('Cache-Control', 'public, max-age=3600');
  }
}));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

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