const SocialPost = require('../models/socialPost');
const {
  createSharePost,
  createStatusPost,
  fetchFollowingFeed,
  fetchWallPosts,
  serializePost,
} = require('../services/social.service');

exports.getWall = async (req, res) => {
  try {
    const limit = Math.min(30, Math.max(1, Number(req.query.limit) || 18));
    const posts = await fetchWallPosts({
      userId: req.params.userId,
      viewerId: req.user?._id,
      limit,
    });
    res.json({ posts });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.getFollowingFeed = async (req, res) => {
  try {
    const limit = Math.min(40, Math.max(1, Number(req.query.limit) || 24));
    const posts = await fetchFollowingFeed({ viewer: req.user, limit });
    res.json({ posts });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.createStatus = async (req, res) => {
  try {
    const text = req.body?.text?.toString().trim();
    if (!text) {
      return res.status(400).json({ message: 'Text is required' });
    }

    const post = await createStatusPost({ authorId: req.user._id, text });
    const hydrated = await SocialPost.findById(post._id)
      .populate('author', 'username profile.avatar profile.city profile.neighborhood stats.score')
      .populate('comments.user', 'username profile.avatar profile.city profile.neighborhood stats.score');

    res.status(201).json(serializePost(hydrated, req.user._id));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.shareToWall = async (req, res) => {
  try {
    const targetType = req.body?.targetType?.toString().trim();
    const targetId = req.body?.targetId?.toString().trim();
    const text = req.body?.text?.toString().trim() || '';

    if (!targetType || !targetId) {
      return res.status(400).json({ message: 'targetType and targetId are required' });
    }

    const post = await createSharePost({
      authorId: req.user._id,
      targetType,
      targetId,
      text,
    });

    if (!post) {
      return res.status(404).json({ message: 'Target not found' });
    }

    const hydrated = await SocialPost.findById(post._id)
      .populate('author', 'username profile.avatar profile.city profile.neighborhood stats.score')
      .populate('comments.user', 'username profile.avatar profile.city profile.neighborhood stats.score');

    res.status(201).json(serializePost(hydrated, req.user._id));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.toggleLike = async (req, res) => {
  try {
    const post = await SocialPost.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }

    const currentUserId = String(req.user._id);
    const existingIndex = post.likes.findIndex((entry) => String(entry) === currentUserId);
    const liked = existingIndex === -1;

    if (liked) {
      post.likes.push(req.user._id);
    } else {
      post.likes.splice(existingIndex, 1);
    }

    await post.save();

    res.json({ liked, likes: post.likes.length });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.comment = async (req, res) => {
  try {
    const text = req.body?.text?.toString().trim();
    if (!text) {
      return res.status(400).json({ message: 'Text is required' });
    }

    const post = await SocialPost.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }

    post.comments.push({ user: req.user._id, text });
    await post.save();

    const hydrated = await SocialPost.findById(post._id)
      .populate('author', 'username profile.avatar profile.city profile.neighborhood stats.score')
      .populate('comments.user', 'username profile.avatar profile.city profile.neighborhood stats.score');

    res.json(serializePost(hydrated, req.user._id));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.getPostById = async (req, res) => {
  try {
    const post = await SocialPost.findById(req.params.id)
      .populate('author', 'username profile.avatar profile.city profile.neighborhood stats.score')
      .populate('comments.user', 'username profile.avatar profile.city profile.neighborhood stats.score');

    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }

    res.json(serializePost(post, req.user._id));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};