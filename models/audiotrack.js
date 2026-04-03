const mongoose = require('mongoose');

const audioTrackSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true
  },
  artist: String,
  genre: String,
  bpm: Number,
  duration: Number,
  audioUrl: String,
  instrumental: {
    type: Boolean,
    default: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  plays: {
    type: Number,
    default: 0
  },
  isPublic: {
    type: Boolean,
    default: true
  },
  shareToCommunity: {
    type: Boolean,
    default: false
  },
  sourceType: {
    type: String,
    enum: ['folder', 'upload', 'recording'],
    default: 'upload'
  },
  sourceFileName: String,
  metadata: {
    effects: {
      reverb: { type: Number, default: 0 },
      autotune: { type: Number, default: 0 }
    },
    channelLevels: {
      leadVox: { type: Number, default: 82 },
      double: { type: Number, default: 64 },
      beat: { type: Number, default: 76 },
      fxBus: { type: Number, default: 48 }
    },
    channelPan: {
      leadVox: { type: Number, default: 0 },
      double: { type: Number, default: -20 },
      beat: { type: Number, default: 0 },
      fxBus: { type: Number, default: 16 }
    },
    instrumentalId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AudioTrack'
    },
    instrumentalTitle: String,
    instrumentalUrl: String,
    rawVoiceUrl: String,
    rawVoiceFileName: String,
    rawVoiceMimeType: String,
    timeline: {
      voiceOffset: { type: Number, default: 0 },
      trimStart: { type: Number, default: 0 },
      trimEnd: { type: Number, default: 0 },
      duration: { type: Number, default: 0 },
      currentPosition: { type: Number, default: 0 },
      zoom: { type: Number, default: 1 },
      loopEnabled: { type: Boolean, default: false },
      loopStart: { type: Number, default: 0 },
      loopEnd: { type: Number, default: 0 },
      sections: [
        {
          label: { type: String, default: 'Section' },
          start: { type: Number, default: 0 },
          end: { type: Number, default: 0 },
          color: { type: String, default: '#FFFFFF' }
        }
      ]
    },
    sourceRecordingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AudioTrack'
    }
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('AudioTrack', audioTrackSchema);