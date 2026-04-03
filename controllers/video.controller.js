const Video = require('../models/video');
const User = require('../models/user');
const path = require('path');
const fs = require('fs');

exports.uploadVideo = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No video file uploaded' });
    }
    
    const { title, description, tags } = req.body;
    
    const video = await Video.create({
      title,
      description,
      user: req.user._id,
      videoUrl: `/uploads/videos/${req.file.filename}`,
      videoPublicId: req.file.filename,
      thumbnailUrl: `/uploads/thumbnails/${req.file.filename}.jpg`,
      tags: tags ? tags.split(',') : []
    });
    
    // Update user stats
    await User.findByIdAndUpdate(req.user._id, {
      $inc: { 'stats.totalViews': 1 }
    });
    
    res.status(201).json(video);
  } catch (error) {
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