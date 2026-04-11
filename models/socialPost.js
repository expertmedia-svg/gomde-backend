const mongoose = require('mongoose');

const socialCommentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    text: {
      type: String,
      required: true,
      trim: true,
      maxlength: 320,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    _id: true,
  }
);

const socialPostSchema = new mongoose.Schema(
  {
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['status', 'video', 'audio', 'battle', 'live', 'repost'],
      required: true,
      index: true,
    },
    text: {
      type: String,
      trim: true,
      maxlength: 500,
      default: '',
    },
    targetType: {
      type: String,
      enum: ['video', 'audio', 'battle', 'live', 'post', 'status'],
      default: 'status',
    },
    targetId: {
      type: String,
      trim: true,
      default: '',
    },
    targetPreview: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    sourceKey: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
    },
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    comments: [socialCommentSchema],
    stats: {
      reposts: { type: Number, default: 0 },
      shares: { type: Number, default: 0 },
    },
    visibility: {
      type: String,
      enum: ['public'],
      default: 'public',
    },
  },
  {
    timestamps: true,
  }
);

socialPostSchema.index({ author: 1, createdAt: -1 });
socialPostSchema.index({ createdAt: -1 });
socialPostSchema.index({ targetType: 1, targetId: 1 });

module.exports = mongoose.model('SocialPost', socialPostSchema);