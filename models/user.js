const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { buildDisciplinePayload, DISCIPLINE_REGISTRY, normalizeDisciplineList } = require('../constants/disciplines');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: [true, 'Username is required'],
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 30
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: 6,
    select: false
  },
  role: {
    type: String,
    enum: ['user', 'artist', 'admin'],
    default: 'user'
  },
  primaryDiscipline: {
    type: String,
    enum: DISCIPLINE_REGISTRY.map((discipline) => discipline.slug),
    default: buildDisciplinePayload(null).primaryCategory,
  },
  disciplines: {
    type: [String],
    default: buildDisciplinePayload(null).categories,
    set: (value) => normalizeDisciplineList(value, { fallback: buildDisciplinePayload(null).categories }),
  },
  profile: {
    fullName: String,
    bio: String,
    avatar: {
      type: String,
      default: '/public/assets/gomde-logo.png'
    },
    city: String,
    neighborhood: String,
    region: String,
    country: String,
    socialLinks: {
      instagram: String,
      twitter: String,
      tiktok: String
    }
  },
  stats: {
    battles: {
      total: { type: Number, default: 0 },
      wins: { type: Number, default: 0 },
      losses: { type: Number, default: 0 }
    },
    score: { type: Number, default: 0 },
    followers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    following: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    totalLikes: { type: Number, default: 0 },
    totalViews: { type: Number, default: 0 },
    totalShares: { type: Number, default: 0 },
    totalBattleVotes: { type: Number, default: 0 }
  },
  wallet: {
    balance: { type: Number, default: 0 },
    lifetimeEarned: { type: Number, default: 0 },
    pendingBalance: { type: Number, default: 0 },
    lastRewardAt: { type: Date, default: null }
  },
  verified: {
    type: Boolean,
    default: false
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastLogin: Date,
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

userSchema.pre('validate', function normalizeUserDisciplines(next) {
  const payload = buildDisciplinePayload(
    this.disciplines?.length ? this.disciplines : this.primaryDiscipline || this.category,
    { fallback: buildDisciplinePayload(null).categories }
  );

  this.disciplines = payload.categories;
  this.primaryDiscipline = payload.primaryCategory;
  next();
});

userSchema.methods.updateStats = function() {
  const wins = Number(this.stats?.battles?.wins || 0);
  const totalBattles = Number(this.stats?.battles?.total || 0);
  const totalLikes = Number(this.stats?.totalLikes || 0);
  const totalViews = Number(this.stats?.totalViews || 0);
  const totalShares = Number(this.stats?.totalShares || 0);
  const totalBattleVotes = Number(this.stats?.totalBattleVotes || 0);

  this.stats.score = Math.max(
    0,
    Math.round(
      wins * 150 +
        totalBattles * 25 +
        totalBattleVotes * 4 +
        totalLikes * 3 +
        totalShares * 6 +
        totalViews
    )
  );
  return this.save();
};

// ── Indexes ──────────────────────────────────────────────────────────
userSchema.index({ 'stats.score': -1 });
userSchema.index({ 'profile.city': 1 });
userSchema.index({ role: 1, createdAt: -1 });

module.exports = mongoose.model('User', userSchema);