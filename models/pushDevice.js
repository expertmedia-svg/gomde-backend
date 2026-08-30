const mongoose = require('mongoose');

const pushDeviceSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    token: {
      type: String,
      required: true,
      unique: true,
      select: false,
    },
    platform: {
      type: String,
      enum: ['android', 'ios', 'web', 'unknown'],
      default: 'unknown',
    },
    deviceId: {
      type: String,
      default: null,
      maxlength: 200,
    },
    lastSeenAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

pushDeviceSchema.index({ user: 1, deviceId: 1 });
pushDeviceSchema.index({ user: 1, lastSeenAt: -1 });

module.exports = mongoose.model('PushDevice', pushDeviceSchema);
