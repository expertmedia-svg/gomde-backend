const Video = require('../models/video');
const Battle = require('../models/battle');
const AudioTrack = require('../models/audiotrack');
const { toPublicMediaUrl } = require('../services/mediaStorage.service');

exports.getSmartFeed = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const parsedPage = Math.max(1, parseInt(page) || 1);
    const parsedLimit = Math.min(50, Math.max(1, parseInt(limit) || 10));
    const recentWindowStart = new Date(Date.now() - (1000 * 60 * 60 * 24 * 10));
    const candidateLimit = Math.min(120, Math.max(parsedLimit * 4, 24));
    
    // Get user's location if available
    const userLocation = req.user?.profile?.city;
    
    // Pour toi is intentionally biased toward fresh and relevant content instead of raw popularity.
    const candidateVideos = await Video.find({
      isPublished: true,
      createdAt: { $gte: recentWindowStart },
    })
      .populate('user', 'username profile.avatar stats.score profile.city')
      .sort({ createdAt: -1 })
      .limit(candidateLimit)
      .lean();

    const videos = candidateVideos.length >= parsedLimit
      ? candidateVideos
      : await Video.find({ isPublished: true })
        .populate('user', 'username profile.avatar stats.score profile.city')
        .sort({ createdAt: -1 })
        .limit(candidateLimit)
        .lean();
    
    const totalVideos = await Video.countDocuments({ isPublished: true });
    
    // Calculate personalized score and then paginate after ranking so the order differs from Tendance.
    const scoredVideos = videos.map(video => {
      const likes = Array.isArray(video.likes) ? video.likes.length : 0;
      const views = video.views || 0;
      const comments = Array.isArray(video.comments) ? video.comments.length : 0;
      const shares = video.shares || 0;
      
      const battleBoost = video.battleId ? 90 : 0;
      const hoursSinceCreation = (Date.now() - new Date(video.createdAt)) / (1000 * 60 * 60);
      const freshnessBoost = Math.max(0, 220 - hoursSinceCreation * 7);
      const totalInteractions = likes + comments + shares;
      const engagementRate = views > 0 ? (totalInteractions / views) * 100 : 0;
      const creatorScore = Number(video.user?.stats?.score || 0);
      const creatorBoost = Math.min(28, creatorScore / 80);
      const trendingPenalty = Math.min(65, views / 180);
      
      let locationBoost = 0;
      if (userLocation && video.user?.profile?.city === userLocation) {
        locationBoost = 70;
      }
      
      const score = 
        (likes * 3.2) +
        (views * 0.04) +
        (comments * 7) +
        (shares * 9) +
        battleBoost +
        freshnessBoost +
        (engagementRate * 3.5) +
        creatorBoost +
        locationBoost -
        trendingPenalty;
      
      return { ...video, score };
    });
    
    // Sort page by score
    scoredVideos.sort((a, b) => b.score - a.score);
    const skip = (parsedPage - 1) * parsedLimit;
    const rankedPage = scoredVideos.slice(skip, skip + parsedLimit);
    
    // Mix content types
    const battles = await Battle.find({ status: { $in: ['voting', 'active'] } })
      .populate('creator', 'username profile.avatar')
      .populate('entries.user', 'username profile.avatar')
      .limit(3)
      .lean();
    
    // Ensure all video URLs are absolute
    const enrichedVideos = rankedPage.map(video => ({
      ...video,
      videoUrl: toPublicMediaUrl(req, video.videoUrl),
      thumbnailUrl: toPublicMediaUrl(req, video.thumbnailUrl)
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
    const enrichedVideos = videos.map(video => ({
      ...video,
      videoUrl: toPublicMediaUrl(req, video.videoUrl),
      thumbnailUrl: toPublicMediaUrl(req, video.thumbnailUrl)
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
    const enrichedVideos = localVideos.map(video => ({
      ...video,
      videoUrl: toPublicMediaUrl(req, video.videoUrl),
      thumbnailUrl: toPublicMediaUrl(req, video.thumbnailUrl)
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
    // Transform AudioTracks to Video-like format for mobile compatibility
    const videos = recordings.map(recording => {
      const videoUrl = toPublicMediaUrl(req, recording.audioUrl);
      const thumbnailUrl = recording.coverImageUrl
        ? toPublicMediaUrl(req, recording.coverImageUrl)
        : toPublicMediaUrl(req, '/public/assets/gomde-logo.png');
      
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