const Video = require('../models/video');
const User = require('../models/user');
const path = require('path');
const { buildDisciplinePayload } = require('../constants/disciplines');
const { buildFileIntegrity } = require('../services/fileIntegrity.service');
const { grantGocoReward } = require('../services/goco.service');
const {
  deleteStoredFile,
  resolveLocalUploadPath,
  toPublicMediaUrl,
  uploadLocalFile,
} = require('../services/mediaStorage.service');
const { createVideoThumbnail, transcodeFeedVideo, safeUnlink } = require('../services/videoTranscode.service');
const { recomputeUserScoreById } = require('../services/score.service');
const { createSharePost, syncPublicationPost } = require('../services/social.service');

const resolveUploadFilePath = (value, subdirectory, fallbackName) => {
  const candidate = typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : fallbackName;

  if (!candidate) {
    return null;
  }

  let fileName = candidate;

  try {
    if (candidate.startsWith('http://') || candidate.startsWith('https://')) {
      fileName = decodeURIComponent(new URL(candidate).pathname.split('/').pop() || '');
    } else {
      fileName = decodeURIComponent(path.basename(candidate));
    }
  } catch (error) {
    fileName = path.basename(candidate);
  }

  if (!fileName) {
    return null;
  }

  return resolveLocalUploadPath(subdirectory, fileName);
};

const ensureAbsoluteUrls = (video, req) => {
  if (!video) return video;

  const enriched = { ...video };
  enriched.videoUrl = toPublicMediaUrl(req, enriched.videoUrl);
  enriched.thumbnailUrl = toPublicMediaUrl(req, enriched.thumbnailUrl);
  return enriched;
};

exports.uploadVideo = async (req, res) => {
  const createdFiles = [];

  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No video file uploaded' });
    }
    
    const { title, description, tags, type, category, categories } = req.body;
    const normalizedType = type === 'battle' ? 'battle' : 'freestyle';
    const normalizedCategories = buildDisciplinePayload(categories || category);
    const normalizedTitle = title?.trim() ||
      (normalizedType === 'battle' ? 'Battle instant' : 'Freestyle instant');
    const sourcePath = req.file.path;
    const sourceFilename = path.basename(sourcePath);
    const sourceExtension = path.extname(sourceFilename).toLowerCase();
    const integrity = await buildFileIntegrity(req.file);
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
    
    const storedVideo = await uploadLocalFile({
      req,
      localPath: resolveLocalUploadPath('videos', asset.videoFilename),
      subdirectory: 'videos',
      fileName: asset.videoFilename,
      contentType: sourceExtension === '.webm' ? 'video/webm' : 'video/mp4',
    });
    const storedThumbnail = asset.thumbnailFilename
      ? await uploadLocalFile({
          req,
          localPath: resolveLocalUploadPath('thumbnails', asset.thumbnailFilename),
          subdirectory: 'thumbnails',
          fileName: asset.thumbnailFilename,
          contentType: 'image/jpeg',
        })
      : null;
    
    const video = await Video.create({
      title: normalizedTitle,
      type: normalizedType,
      primaryCategory: normalizedCategories.primaryCategory,
      categories: normalizedCategories.categories,
      description,
      user: req.user._id,
      videoUrl: storedVideo.publicUrl,
      videoPublicId: storedVideo.objectKey || asset.videoFilename,
      uploadChecksum: integrity?.checksum || '',
      uploadSizeBytes: integrity?.sizeBytes || 0,
      uploadMimeType: integrity?.mimeType || '',
      thumbnailUrl: storedThumbnail?.publicUrl || '',
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

    await syncPublicationPost({
      authorId: req.user._id,
      targetType: 'video',
      targetId: video._id,
      text: description || normalizedTitle,
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
      .populate('comments.user', 'username profile.avatar')
      .lean();
    
    if (!video) {
      return res.status(404).json({ message: 'Video not found' });
    }

    const enrichedVideo = ensureAbsoluteUrls(video, req);
    res.json(enrichedVideo);
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

    await recomputeUserScoreById(video.user);
    await grantGocoReward({
      userId: video.user,
      actorId: req.user?._id || null,
      actionType: 'video_view',
      targetType: 'video',
      targetId: video._id,
      metadata: { title: video.title },
      eventKey: `video_view:${video._id}:${req.user?._id || req.ip}:${new Date().toISOString().slice(0, 10)}`,
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

    await recomputeUserScoreById(video.user);
    
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

    await User.findByIdAndUpdate(video.user, {
      $inc: { 'stats.totalShares': 1 }
    });
    await recomputeUserScoreById(video.user);
    await grantGocoReward({
      userId: video.user,
      actorId: req.user._id,
      actionType: 'content_share',
      targetType: 'video',
      targetId: video._id,
      metadata: { title: video.title },
      eventKey: `video_share:${video._id}:${req.user._id}:${new Date().toISOString().slice(0, 10)}`,
    });
    await createSharePost({
      authorId: req.user._id,
      targetType: 'video',
      targetId: video._id,
    });
    
    res.json({ shares: video.shares });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.deleteVideo = async (req, res) => {
  try {
    const video = await Video.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!video) {
      return res.status(404).json({ message: 'Video not found' });
    }

    const likeCount = Array.isArray(video.likes) ? video.likes.length : 0;
    const views = Number(video.views || 0);
    const shares = Number(video.shares || 0);
    const videoPath = resolveUploadFilePath(
      video.videoUrl,
      'videos',
      video.videoPublicId,
    );
    const thumbnailPath = resolveUploadFilePath(video.thumbnailUrl, 'thumbnails');

    await video.deleteOne();

    for (const filePath of [videoPath, thumbnailPath]) {
      if (!filePath) {
        continue;
      }

      try {
        await safeUnlink(filePath);
      } catch (cleanupError) {
        console.error(cleanupError);
      }
    }

    for (const remoteTarget of [
      { value: video.videoUrl, fileName: video.videoPublicId, subdirectory: 'videos' },
      { value: video.thumbnailUrl, subdirectory: 'thumbnails' },
    ]) {
      try {
        await deleteStoredFile(remoteTarget);
      } catch (cleanupError) {
        console.error(cleanupError);
      }
    }

    await User.findByIdAndUpdate(video.user, {
      $inc: {
        'stats.totalLikes': -likeCount,
        'stats.totalViews': -views,
        'stats.totalShares': -shares,
      }
    });
    await recomputeUserScoreById(video.user);

    res.json({ success: true, id: req.params.id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};