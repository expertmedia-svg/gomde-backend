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
    const parsedPage = Math.max(1, parseInt(page) || 1);
    const parsedLimit = Math.min(50, Math.max(1, parseInt(limit) || 10));
    
    // Get user's location if available
    const userLocation = req.user?.profile?.city;
    
    // Paginated query sorted by recency + popularity via aggregation
    const skip = (parsedPage - 1) * parsedLimit;
    
    const videos = await Video.find({ isPublished: true })
      .populate('user', 'username profile.avatar stats.score profile.city')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parsedLimit)
      .lean();
    
    const totalVideos = await Video.countDocuments({ isPublished: true });
    
    // Calculate score for each video (already paginated)
    const scoredVideos = videos.map(video => {
      const likes = Array.isArray(video.likes) ? video.likes.length : 0;
      const views = video.views || 0;
      const comments = Array.isArray(video.comments) ? video.comments.length : 0;
      const shares = video.shares || 0;
      
      const battleBoost = video.battleId ? 50 : 0;
      const hoursSinceCreation = (Date.now() - new Date(video.createdAt)) / (1000 * 60 * 60);
      const freshnessBoost = Math.max(0, 100 - hoursSinceCreation * 2);
      const totalInteractions = likes + comments + shares;
      const engagementRate = views > 0 ? (totalInteractions / views) * 100 : 0;
      
      let locationBoost = 0;
      if (userLocation && video.user?.profile?.city === userLocation) {
        locationBoost = 30;
      }
      
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
    
    // Sort page by score
    scoredVideos.sort((a, b) => b.score - a.score);
    
    // Mix content types
    const battles = await Battle.find({ status: { $in: ['voting', 'active'] } })
      .populate('creator', 'username profile.avatar')
      .populate('entries.user', 'username profile.avatar')
      .limit(3)
      .lean();
    
    // Ensure all video URLs are absolute
    const protocol = getRequestProtocol(req);
    const host = req.get('host') || process.env.PUBLIC_HOST || 'localhost:5000';
    const baseUrl = `${protocol}://${host}`;
    
    const enrichedVideos = scoredVideos.map(video => ({
      ...video,
      videoUrl: video.videoUrl?.startsWith('http') 
        ? video.videoUrl 
        : `${baseUrl}${video.videoUrl}`,
      thumbnailUrl: video.thumbnailUrl && !video.thumbnailUrl.startsWith('http')
        ? `${baseUrl}${video.thumbnailUrl}`
        : video.thumbnailUrl
    }));
    
    res.json({
      videos: enrichedVideos,
      battles,
      currentPage: parsedPage,
      hasMore: skip + parsedLimit < totalVideos
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.getTrending = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const videos = await Video.find({ isPublished: true })
      .populate('user', 'username profile.avatar profile.city')
      .sort({ views: -1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();
    
    // Ensure all video URLs are absolute
    const protocol = getRequestProtocol(req);
    const host = req.get('host') || process.env.PUBLIC_HOST || 'localhost:5000';
    const baseUrl = `${protocol}://${host}`;
    
    const enrichedVideos = videos.map(video => ({
      ...video,
      videoUrl: video.videoUrl && !video.videoUrl.startsWith('http')
        ? `${baseUrl}${video.videoUrl}`
        : video.videoUrl,
      thumbnailUrl: video.thumbnailUrl && !video.thumbnailUrl.startsWith('http')
        ? `${baseUrl}${video.thumbnailUrl}`
        : video.thumbnailUrl
    }));

    const total = await Video.countDocuments({ isPublished: true });
    
    res.json({
      videos: enrichedVideos,
      battles: [],
      currentPage: parseInt(page),
      hasMore: skip + parseInt(limit) < total
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.getLocalContent = async (req, res) => {
  try {
    const userLocation = req.user?.profile?.city;
    
    if (!userLocation) {
      return res.json({ videos: [], battles: [], currentPage: 1, hasMore: false });
    }
    
    // Use aggregation to filter by user location in DB instead of loading all videos
    const localVideos = await Video.aggregate([
      { $match: { isPublished: true } },
      { $lookup: { from: 'users', localField: 'user', foreignField: '_id', as: 'userDoc' } },
      { $unwind: '$userDoc' },
      { $match: { 'userDoc.profile.city': { $regex: new RegExp(`^${userLocation.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}$`, 'i') } } },
      { $sort: { createdAt: -1 } },
      { $limit: 20 },
      { $project: {
        title: 1, description: 1, videoUrl: 1, thumbnailUrl: 1, views: 1,
        likes: 1, comments: 1, shares: 1, battleId: 1, createdAt: 1,
        user: {
          _id: '$userDoc._id',
          username: '$userDoc.username',
          'profile.avatar': '$userDoc.profile.avatar',
          'profile.city': '$userDoc.profile.city'
        }
      }}
    ]);

    // Ensure all video URLs are absolute
    const protocol = getRequestProtocol(req);
    const host = req.get('host') || process.env.PUBLIC_HOST || 'localhost:5000';
    const baseUrl = `${protocol}://${host}`;
    
    const enrichedVideos = localVideos.map(video => ({
      ...video,
      videoUrl: video.videoUrl && !video.videoUrl.startsWith('http')
        ? `${baseUrl}${video.videoUrl}`
        : video.videoUrl,
      thumbnailUrl: video.thumbnailUrl && !video.thumbnailUrl.startsWith('http')
        ? `${baseUrl}${video.thumbnailUrl}`
        : video.thumbnailUrl
    }));
    
    res.json({
      videos: enrichedVideos,
      battles: [],
      currentPage: 1,
      hasMore: false
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Get Gomdé Zik - Local shared audio recordings
exports.getGomdezik = async (req, res) => {
  try {
    const { page = 1, limit = 12 } = req.query;
    const parsedLimit = Math.min(50, Math.max(1, parseInt(limit) || 12));
    const parsedPage = Math.max(1, parseInt(page) || 1);
    const userLocation = req.user?.profile?.city;
    
    // Get all shared recordings (shareToCommunity = true, instrumental = false)
    // Note: user.profile.city cannot be queried here because 'user' is a ref (ObjectId),
    // city is only available after populate. Filter by location post-populate if needed.
    const query = {
      shareToCommunity: true,
      instrumental: false
    };
    
    const recordings = await AudioTrack.find(query)
      .populate('user', 'username profile.avatar profile.city')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .lean();
    
    const total = await AudioTrack.countDocuments(query);
    
    // Ensure all URLs are absolute
    const protocol = getRequestProtocol(req);
    const host = req.get('host') || process.env.PUBLIC_HOST || 'localhost:5000';
    const baseUrl = `${protocol}://${host}`;
    
    // Transform AudioTracks to Video-like format for mobile compatibility
    const videos = recordings.map(recording => {
      const videoUrl = recording.audioUrl 
        ? (recording.audioUrl.startsWith('http') 
            ? recording.audioUrl 
            : `${baseUrl}${recording.audioUrl}`)
        : '';
      
      // Use cover if available, otherwise use GOMDE logo as default
      const thumbnailUrl = recording.coverImageUrl
        ? (recording.coverImageUrl.startsWith('http')
            ? recording.coverImageUrl
            : `${baseUrl}${recording.coverImageUrl}`)
        : `${baseUrl}/public/assets/gomde-logo.png`;
      
      return {
        _id: recording._id,
        id: recording._id.toString(),
        title: recording.title || 'Sans titre',
        description: `${recording.title || 'Enregistrement'} - ${recording.artist || recording.user?.username || 'Artiste'}`,
        videoUrl,
        thumbnailUrl,
        user: {
          _id: recording.user?._id,
          username: recording.user?.username || 'Artiste',
          avatar: recording.user?.profile?.avatar,
          city: recording.user?.profile?.city
        },
        likes: recording.likes || [],
        comments: recording.comments || [],
        shares: recording.shares || 0,
        views: recording.plays || 0,
        type: 'audio',
        createdAt: recording.createdAt,
        isAudio: true,
        sourceType: 'gomdezik'
      };
    });
    
    console.log(`[Gomdé Zik] Returning ${videos.length} transformed videos`);
    
    res.json({
      videos,
      battles: [],
      currentPage: parseInt(page),
      hasMore: (page - 1) * limit + limit < total
    });
  } catch (error) {
    console.error('[Gomdé Zik] Error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};