const Video = require('../models/video');
const User = require('../models/user');
const path = require('path');
const { createVideoThumbnail, transcodeFeedVideo, safeUnlink } = require('../services/videoTranscode.service');

exports.uploadVideo = async (req, res) => {
  const createdFiles = [];

  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No video file uploaded' });
    }
    
    const { title, description, tags, type } = req.body;
    const normalizedType = type === 'battle' ? 'battle' : 'freestyle';
    const normalizedTitle = title?.trim() ||
      (normalizedType === 'battle' ? 'Battle instant' : 'Freestyle instant');
    const sourcePath = req.file.path;
    const sourceFilename = path.basename(sourcePath);
    const sourceExtension = path.extname(sourceFilename).toLowerCase();
    let asset = null;
    let usedTranscodeFallback = false;

    try {
      const outputBasename = `${path.parse(req.file.filename).name}-mobile`;
      const transcoded = await transcodeFeedVideo({
        inputPath: sourcePath,
        outputBasename,
      });

      createdFiles.push(transcoded.outputPath, transcoded.thumbnailPath);
      await safeUnlink(sourcePath);

      asset = {
        videoFilename: transcoded.outputFilename,
        thumbnailFilename: transcoded.thumbnailFilename,
      };
    } catch (transcodeError) {
      console.warn('Feed video transcode failed, evaluating fallback:', transcodeError.message);

      if (sourceExtension !== '.mp4') {
        await safeUnlink(sourcePath);
        return res.status(422).json({
          message: 'La vidéo n’a pas pu être convertie vers un format mobile compatible. Réessaie avec une nouvelle capture.',
        });
      }

      usedTranscodeFallback = true;
      let thumbnailFilename = null;

      try {
        thumbnailFilename = `${path.parse(sourceFilename).name}.jpg`;
        const thumbnailPath = path.join(
          path.dirname(path.dirname(sourcePath)),
          'thumbnails',
          thumbnailFilename
        );
        await createVideoThumbnail({ inputPath: sourcePath, thumbnailPath });
        createdFiles.push(thumbnailPath);
      } catch (thumbnailError) {
        console.warn('Feed thumbnail fallback failed:', thumbnailError.message);
        thumbnailFilename = null;
      }

      asset = {
        videoFilename: sourceFilename,
        thumbnailFilename,
      };
    }
    
    const video = await Video.create({
      title: normalizedTitle,
      type: normalizedType,
      description,
      user: req.user._id,
      videoUrl: `/uploads/videos/${asset.videoFilename}`,
      videoPublicId: asset.videoFilename,
      thumbnailUrl: asset.thumbnailFilename ? `/uploads/thumbnails/${asset.thumbnailFilename}` : '',
      tags: tags ? tags.split(',') : []
    });

    if (usedTranscodeFallback) {
      console.warn(
        '[feed-video] fallback mp4 used',
        JSON.stringify({
          userId: String(req.user._id),
          sourceFilename,
          storedFilename: asset.videoFilename,
        })
      );
    } else {
      console.info(
        '[feed-video] transcoded',
        JSON.stringify({
          userId: String(req.user._id),
          sourceFilename,
          storedFilename: asset.videoFilename,
        })
      );
    }
    
    // Update user stats
    await User.findByIdAndUpdate(req.user._id, {
      $inc: { 'stats.totalViews': 1 }
    });
    
    res.status(201).json({
      ...video.toObject(),
      processingFallback: usedTranscodeFallback,
    });
  } catch (error) {
    if (req.file?.path) {
      try {
        await safeUnlink(req.file.path);
      } catch (cleanupError) {
        console.error(cleanupError);
      }
    }
    for (const filePath of createdFiles) {
      try {
        await safeUnlink(filePath);
      } catch (cleanupError) {
        console.error(cleanupError);
      }
    }
    console.error(error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.getVideos = async (req, res) => {
  try {
    const { page = 1, limit = 10, userId, battleId } = req.query;
    const query = { isPublished: true };
    
    if (userId) query.user = userId;
    if (battleId) query.battleId = battleId;
    
    const videos = await Video.find(query)
      .populate('user', 'username profile.avatar stats.score')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);
    
    const total = await Video.countDocuments(query);
    
    res.json({
      videos,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.getVideoById = async (req, res) => {
  try {
    const video = await Video.findById(req.params.id)
      .populate('user', 'username profile.avatar stats.score')
      .populate('comments.user', 'username profile.avatar');
    
    if (!video) {
      return res.status(404).json({ message: 'Video not found' });
    }

    res.json(video);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.incrementVideoView = async (req, res) => {
  try {
    const video = await Video.findById(req.params.id);

    if (!video) {
      return res.status(404).json({ message: 'Video not found' });
    }

    await video.incrementViews();

    await User.findByIdAndUpdate(video.user, {
      $inc: { 'stats.totalViews': 1 }
    });

    res.json({ views: video.views });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.likeVideo = async (req, res) => {
  try {
    const video = await Video.findById(req.params.id);
    
    if (!video) {
      return res.status(404).json({ message: 'Video not found' });
    }
    
    const result = await video.toggleLike(req.user._id);
    
    // Update user stats
    await User.findByIdAndUpdate(video.user, {
      $inc: { 'stats.totalLikes': result.liked ? 1 : -1 }
    });
    
    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.commentVideo = async (req, res) => {
  try {
    const { text } = req.body;
    const video = await Video.findById(req.params.id);
    
    if (!video) {
      return res.status(404).json({ message: 'Video not found' });
    }
    
    video.comments.push({
      user: req.user._id,
      text
    });
    
    await video.save();
    
    const populatedVideo = await Video.findById(video._id)
      .populate('comments.user', 'username profile.avatar');
    
    res.json(populatedVideo.comments);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.shareVideo = async (req, res) => {
  try {
    const video = await Video.findById(req.params.id);
    
    if (!video) {
      return res.status(404).json({ message: 'Video not found' });
    }
    
    video.shares += 1;
    await video.save();
    
    res.json({ shares: video.shares });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};