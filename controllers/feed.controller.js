const Video = require('../models/video');
const Battle = require('../models/battle');
const AudioTrack = require('../models/audiotrack');

// Helper to get correct protocol (handles nginx reverse proxy)
const getRequestProtocol = (req) => {
  // Use x-forwarded-proto header from reverse proxy (nginx sets this)
  const forwardedProto = req.get('x-forwarded-proto');
  if (forwardedProto) return forwardedProto;
  
  // Fallback: force https in production, req.protocol for local dev
  if (process.env.NODE_ENV === 'production') {
    return 'https';
  }
  return req.protocol || 'https';
};

exports.getSmartFeed = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    
    // Get user's location if available
    const userLocation = req.user?.profile?.city;
    
    // Get videos with computed scores
    const videos = await Video.find({ isPublished: true })
      .populate('user', 'username profile.avatar stats.score profile.city')
      .lean();
    
    // Calculate score for each video
    const scoredVideos = videos.map(video => {
      const likes = video.likes.length;
      const views = video.views;
      const comments = video.comments.length;
      const shares = video.shares;
      
      // Battle boost if video is from a battle
      const battleBoost = video.battleId ? 50 : 0;
      
      // Freshness boost (newer videos get higher score)
      const hoursSinceCreation = (Date.now() - new Date(video.createdAt)) / (1000 * 60 * 60);
      const freshnessBoost = Math.max(0, 100 - hoursSinceCreation * 2);
      
      // Engagement rate
      const totalInteractions = likes + comments + shares;
      const engagementRate = views > 0 ? (totalInteractions / views) * 100 : 0;
      
      // Location boost
      let locationBoost = 0;
      if (userLocation && video.user.profile?.city === userLocation) {
        locationBoost = 30;
      }
      
      // Calculate final score
      const score = 
        (likes * 4) +
        (views * 0.3) +
        (comments * 5) +
        (shares * 6) +
        battleBoost +
        freshnessBoost +
        (engagementRate * 2) +
        locationBoost;
      
      return { ...video, score };
    });
    
    // Sort by score
    scoredVideos.sort((a, b) => b.score - a.score);
    
    // Paginate
    const start = (page - 1) * limit;
    const paginatedVideos = scoredVideos.slice(start, start + limit);
    
    // Mix content types
    const battles = await Battle.find({ status: 'active' })
      .populate('creator', 'username profile.avatar')
      .populate('entries.user', 'username profile.avatar')
      .limit(3)
      .lean();
    
    // Ensure all video URLs are absolute
    const protocol = getRequestProtocol(req);
    const host = req.get('host') || 'gomde.yingr-ai.com';
    const baseUrl = `${protocol}://${host}`;
    
    const enrichedVideos = paginatedVideos.map(video => ({
      ...video,
      videoUrl: video.videoUrl.startsWith('http') 
        ? video.videoUrl 
        : `${baseUrl}${video.videoUrl}`,
      thumbnailUrl: video.thumbnailUrl && !video.thumbnailUrl.startsWith('http')
        ? `${baseUrl}${video.thumbnailUrl}`
        : video.thumbnailUrl
    }));
    
    res.json({
      videos: enrichedVideos,
      battles,
      currentPage: page,
      hasMore: start + limit < scoredVideos.length
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.getTrending = async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    
    const videos = await Video.find({ isPublished: true })
      .populate('user', 'username profile.avatar')
      .sort({ views: -1, createdAt: -1 })
      .limit(parseInt(limit));
    
    res.json(videos);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.getLocalContent = async (req, res) => {
  try {
    const userLocation = req.user?.profile?.city;
    
    if (!userLocation) {
      return res.json([]);
    }
    
    const videos = await Video.find({ 
      isPublished: true,
      'user.profile.city': userLocation 
    })
      .populate('user', 'username profile.avatar profile.city')
      .sort({ createdAt: -1 })
      .limit(20);
    
    res.json(videos);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Get Gomdé Zik - Local shared audio recordings
exports.getGomdezik = async (req, res) => {
  try {
    const { page = 1, limit = 12 } = req.query;
    const userLocation = req.user?.profile?.city;
    
    // Get shared recordings (shareToCommunity = true, instrumental = false)
    const query = {
      shareToCommunity: true,
      instrumental: false,
      isPublic: true
    };
    
    // Add location filter if user has a location
    if (userLocation) {
      query['user.profile.city'] = userLocation;
    }
    
    const recordings = await AudioTrack.find(query)
      .populate('user', 'username profile.avatar profile.city')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));
    
    const total = await AudioTrack.countDocuments(query);
    
    res.json({
      recordings,
      currentPage: page,
      totalPages: Math.ceil(total / limit),
      hasMore: page * limit < total
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};