const AudioTrack = require('../models/audiotrack');
const Battle = require('../models/battle');
const SocialPost = require('../models/socialPost');
const User = require('../models/user');
const Video = require('../models/video');

const PUBLIC_USER_FIELDS = 'username profile.avatar profile.city profile.neighborhood stats.score';

const compactUser = (user) => {
  if (!user) {
    return null;
  }

  const source = typeof user.toObject === 'function' ? user.toObject() : user;
  return {
    id: String(source._id || source.id || ''),
    username: source.username || 'Artiste',
    avatar: source.profile?.avatar || '',
    city: source.profile?.city || '',
    neighborhood: source.profile?.neighborhood || '',
    score: Number(source.stats?.score || 0),
  };
};

const serializePost = (post, viewerId = null) => {
  if (!post) {
    return null;
  }

  const source = typeof post.toObject === 'function' ? post.toObject() : post;
  const likedByViewer = viewerId
    ? (source.likes || []).some((entry) => String(entry?._id || entry) === String(viewerId))
    : false;

  return {
    id: String(source._id || source.id),
    type: source.type,
    text: source.text || '',
    targetType: source.targetType || 'status',
    targetId: source.targetId || '',
    targetPreview: source.targetPreview || null,
    author: compactUser(source.author),
    likesCount: Array.isArray(source.likes) ? source.likes.length : 0,
    commentsCount: Array.isArray(source.comments) ? source.comments.length : 0,
    repostsCount: Number(source.stats?.reposts || 0),
    sharesCount: Number(source.stats?.shares || 0),
    likedByViewer,
    comments: Array.isArray(source.comments)
      ? source.comments.slice(0, 4).map((comment) => ({
          id: String(comment._id),
          text: comment.text,
          createdAt: comment.createdAt,
          user: compactUser(comment.user),
        }))
      : [],
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  };
};

const resolveTargetPreview = async ({ targetType, targetId }) => {
  if (!targetType || !targetId) {
    return null;
  }

  if (targetType === 'video') {
    const video = await Video.findOne({ _id: targetId, isPublished: true })
      .populate('user', PUBLIC_USER_FIELDS)
      .lean(false);
    if (!video) {
      return null;
    }

    return {
      type: 'video',
      id: String(video._id),
      title: video.title,
      description: video.description || '',
      route: `/profile/${video.user?._id || video.user?.id}?shared=${video._id}&type=video`,
      mediaUrl: video.videoUrl || '',
      thumbnailUrl: video.thumbnailUrl || '',
      author: compactUser(video.user),
      metrics: {
        views: Number(video.views || 0),
        likes: Array.isArray(video.likes) ? video.likes.length : 0,
        shares: Number(video.shares || 0),
      },
      meta: {
        primaryCategory: video.primaryCategory || '',
        categories: video.categories || [],
      },
    };
  }

  if (targetType === 'audio') {
    const recording = await AudioTrack.findOne({
      _id: targetId,
      instrumental: false,
      shareToCommunity: true,
      isPublic: true,
    })
      .populate('user', PUBLIC_USER_FIELDS)
      .lean(false);
    if (!recording) {
      return null;
    }

    return {
      type: 'audio',
      id: String(recording._id),
      title: recording.title,
      description: recording.description || '',
      route: `/profile/${recording.user?._id || recording.user?.id}?shared=${recording._id}&type=audio`,
      mediaUrl: recording.audioUrl || '',
      thumbnailUrl: recording.coverImageUrl || '',
      author: compactUser(recording.user),
      metrics: {
        plays: Number(recording.plays || 0),
        likes: Array.isArray(recording.likes) ? recording.likes.length : 0,
        shares: Number(recording.shares || 0),
      },
      meta: {
        primaryCategory: recording.primaryCategory || '',
        genre: recording.genre || '',
      },
    };
  }

  if (targetType === 'battle' || targetType === 'live') {
    const battle = await Battle.findById(targetId)
      .populate('creator', PUBLIC_USER_FIELDS)
      .populate('challenger', PUBLIC_USER_FIELDS)
      .populate('winner', PUBLIC_USER_FIELDS)
      .lean(false);
    if (!battle) {
      return null;
    }

    const isLive = ['active', 'voting'].includes(battle.status) || targetType === 'live';
    return {
      type: isLive ? 'live' : 'battle',
      id: String(battle._id),
      title: battle.title,
      description: battle.description || '',
      route: isLive ? `/live/${battle._id}` : `/battle/${battle._id}`,
      mediaUrl: '',
      thumbnailUrl: '',
      author: compactUser(battle.creator),
      metrics: {
        entries: Array.isArray(battle.entries) ? battle.entries.length : 0,
        votes: Array.isArray(battle.votes) ? battle.votes.length : 0,
      },
      meta: {
        status: battle.status,
        prize: battle.prize || '',
        challenger: compactUser(battle.challenger),
        winner: compactUser(battle.winner),
      },
    };
  }

  if (targetType === 'post') {
    const post = await SocialPost.findById(targetId).populate('author', PUBLIC_USER_FIELDS).lean(false);
    if (!post) {
      return null;
    }

    return {
      type: 'post',
      id: String(post._id),
      title: post.text || 'Publication GOMDE',
      description: post.text || '',
      route: `/profile/${post.author?._id || post.author?.id}`,
      mediaUrl: post.targetPreview?.mediaUrl || '',
      thumbnailUrl: post.targetPreview?.thumbnailUrl || '',
      author: compactUser(post.author),
      metrics: {
        likes: Array.isArray(post.likes) ? post.likes.length : 0,
        comments: Array.isArray(post.comments) ? post.comments.length : 0,
      },
      meta: {
        targetType: post.targetType,
      },
    };
  }

  return null;
};

const createStatusPost = async ({ authorId, text }) => {
  return SocialPost.create({
    author: authorId,
    type: 'status',
    targetType: 'status',
    text: text?.trim() || '',
  });
};

const syncPublicationPost = async ({ authorId, targetType, targetId, text = '' }) => {
  const targetPreview = await resolveTargetPreview({ targetType, targetId });
  if (!targetPreview) {
    return null;
  }

  return SocialPost.findOneAndUpdate(
    { sourceKey: `publication:${targetType}:${targetId}` },
    {
      $set: {
        author: authorId,
        type: targetType === 'audio' ? 'audio' : targetType,
        targetType,
        targetId: String(targetId),
        targetPreview,
        text: text?.trim() || targetPreview.description || targetPreview.title || '',
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
};

const createSharePost = async ({ authorId, targetType, targetId, text = '' }) => {
  const targetPreview = await resolveTargetPreview({ targetType, targetId });
  if (!targetPreview) {
    return null;
  }

  const postType = targetType === 'live' ? 'live' : targetType === 'battle' ? 'battle' : 'repost';
  const post = await SocialPost.create({
    author: authorId,
    type: postType,
    targetType,
    targetId: String(targetId),
    targetPreview,
    text: text?.trim() || '',
  });

  if (targetType === 'post') {
    await SocialPost.findByIdAndUpdate(targetId, { $inc: { 'stats.reposts': 1 } });
  }

  return post;
};

const fetchWallPosts = async ({ userId, viewerId = null, limit = 20 }) => {
  const posts = await SocialPost.find({ author: userId, visibility: 'public' })
    .populate('author', PUBLIC_USER_FIELDS)
    .populate('comments.user', PUBLIC_USER_FIELDS)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean(false);

  return posts.map((post) => serializePost(post, viewerId));
};

const fetchFollowingFeed = async ({ viewer, limit = 24 }) => {
  const viewerDoc = viewer?._id ? viewer : await User.findById(viewer).select('stats.following');
  const authorIds = Array.from(new Set([
    String(viewerDoc?._id || viewer),
    ...((viewerDoc?.stats?.following || []).map((entry) => String(entry))),
  ].filter(Boolean)));

  const posts = await SocialPost.find({
    author: { $in: authorIds },
    visibility: 'public',
  })
    .populate('author', PUBLIC_USER_FIELDS)
    .populate('comments.user', PUBLIC_USER_FIELDS)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean(false);

  return posts.map((post) => serializePost(post, viewerDoc?._id || viewer));
};

module.exports = {
  createSharePost,
  createStatusPost,
  fetchFollowingFeed,
  fetchWallPosts,
  serializePost,
  syncPublicationPost,
};