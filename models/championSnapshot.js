const mongoose = require('mongoose');

const championSnapshotSchema = new mongoose.Schema({
  category: {
    type: String,
    required: true,
    trim: true,
  },
  level: {
    type: String,
    enum: ['sector', 'regional', 'national'],
    required: true,
  },
  geographyKey: {
    type: String,
    required: true,
    trim: true,
  },
  geographyLabel: {
    type: String,
    required: true,
    trim: true,
  },
  holder: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  previousHolder: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  sourceBattle: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Battle',
  },
  stats: {
    officialScore: { type: Number, default: 0 },
    wins: { type: Number, default: 0 },
    totalBattles: { type: Number, default: 0 },
    totalVotesReceived: { type: Number, default: 0 },
  },
  active: {
    type: Boolean,
    default: true,
  },
  startedAt: {
    type: Date,
    default: Date.now,
  },
  endedAt: Date,
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

championSnapshotSchema.index(
  { category: 1, level: 1, geographyKey: 1, active: 1 },
  { unique: true, partialFilterExpression: { active: true } }
);
championSnapshotSchema.index({ holder: 1, active: 1, updatedAt: -1 });

championSnapshotSchema.pre('save', function updateTimestamp(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('ChampionSnapshot', championSnapshotSchema);