const mongoose = require('mongoose');

const gocoTransactionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    actionType: {
      type: String,
      enum: ['video_view', 'audio_play', 'content_share', 'manual_bonus', 'withdrawal_request', 'withdrawal_rejected'],
      required: true,
      index: true,
    },
    targetType: {
      type: String,
      enum: ['video', 'audio', 'battle', 'live', 'post', 'wallet'],
      required: true,
    },
    targetId: {
      type: String,
      required: true,
      trim: true,
    },
    eventKey: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
    },
    balanceAfter: {
      type: Number,
      default: 0,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

gocoTransactionSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('GocoTransaction', gocoTransactionSchema);