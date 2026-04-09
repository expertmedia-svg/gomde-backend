const mongoose = require('mongoose');

const videoSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  type: {
    type: String,
    enum: ['freestyle', 'battle'],
    default: 'freestyle'
  },
  description: String,
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  videoUrl: {
    type: String,
    required: true
  },
  videoPublicId: String,
  thumbnailUrl: String,
  duration: Number,
  views: {
    type: Number,
    default: 0
  },
  likes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  comments: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    text: {
      type: String,
      maxlength: 1000
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  shares: {
    type: Number,
    default: 0
  },
  battleId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Battle'
  },
  isPublished: {
    type: Boolean,
    default: true
  },
  tags: [String],
  location: {
    city: String,
    country: String
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// ── Indexes ──────────────────────────────────────────────────────────
videoSchema.index({ user: 1, createdAt: -1 });
videoSchema.index({ isPublished: 1, createdAt: -1 });
videoSchema.index({ battleId: 1 });

videoSchema.methods.incrementViews = function() {
  this.views += 1;
  return this.save();
};

videoSchema.methods.toggleLike = async function(userId) {
  const index = this.likes.indexOf(userId);
  if (index === -1) {
    this.likes.push(userId);
    await this.save();
    return { liked: true };
  } else {
    this.likes.splice(index, 1);
    await this.save();
    return { liked: false };
  }
};

module.exports = mongoose.model('Video', videoSchema);