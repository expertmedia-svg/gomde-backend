const mongoose = require('mongoose');

const gocoWithdrawalSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    payoutMethod: {
      type: String,
      enum: ['mobile_money', 'bank_transfer'],
      default: 'mobile_money',
    },
    payoutLabel: {
      type: String,
      trim: true,
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    adminNote: {
      type: String,
      trim: true,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

gocoWithdrawalSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('GocoWithdrawal', gocoWithdrawalSchema);