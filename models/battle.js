const mongoose = require('mongoose');
const { buildDisciplinePayload, DISCIPLINE_REGISTRY, normalizeDisciplineList } = require('../constants/disciplines');

// ── Timing constants ─────────────────────────────────────────────────
const SUBMISSION_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 h pour soumettre sa vidéo
const VOTING_WINDOW_MS = 6 * 24 * 60 * 60 * 1000; // 6 jours de vote

const battleSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Battle title is required'],
    trim: true,
    maxlength: 100
  },
  description: {
    type: String,
    maxlength: 500
  },
  primaryCategory: {
    type: String,
    enum: DISCIPLINE_REGISTRY.map((discipline) => discipline.slug),
    default: buildDisciplinePayload(null).primaryCategory,
  },
  categories: {
    type: [String],
    default: buildDisciplinePayload(null).categories,
    set: (value) => normalizeDisciplineList(value, { fallback: buildDisciplinePayload(null).categories }),
  },

  // ── Participants ───────────────────────────────────────────────────
  creator: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  challenger: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  // ── Challenge flow ─────────────────────────────────────────────────
  // pending   → creator a créé, challenger pas encore notifié ou sélectionné
  // challenged → challenge envoyé, en attente de réponse du challenger
  // accepted  → challenger a accepté, 24 h pour soumettre les vidéos
  // active    → les 2 vidéos soumises, en phase de vote (6 j)
  // voting    → alias lisible (maping sur active après soumission)
  // completed → votes clos, vainqueur calculé
  // refused   → challenger a refusé
  // cancelled → créateur a annulé
  // forfeited → un participant n'a pas soumis dans les 24 h
  status: {
    type: String,
    enum: [
      'pending',
      'challenged',
      'accepted',
      'active',
      'voting',
      'completed',
      'refused',
      'cancelled',
      'forfeited'
    ],
    default: 'pending'
  },

  entries: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    videoUrl: String,
    videoPublicId: String,
    thumbnailUrl: String,
    uploadChecksum: String,
    uploadSizeBytes: {
      type: Number,
      default: 0,
    },
    uploadMimeType: String,
    uploadedAt: {
      type: Date,
      default: Date.now
    },
    score: {
      type: Number,
      default: 0
    }
  }],

  votes: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    votedFor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],

  winner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  resultApplied: {
    type: Boolean,
    default: false
  },
  prize: {
    type: Number,
    default: 0
  },

  rules: {
    maxDuration: { type: Number, default: 60 },
    allowInstrumentals: { type: Boolean, default: true },
    requiredOriginal: { type: Boolean, default: false }
  },

  views: { type: Number, default: 0 },
  likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
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

  // ── Deadlines ──────────────────────────────────────────────────────
  // Date à laquelle le challenge a été accepté
  acceptedAt: Date,
  // Deadline pour soumettre sa vidéo (acceptedAt + 24 h)
  submissionDeadline: Date,
  // Deadline de fin des votes (activatedAt + 6 j)
  voteDeadline: Date,
  completedAt: Date,
  lifecycle: {
    inLiveFeed: {
      type: Boolean,
      default: false,
    },
    enteredLiveAt: Date,
    archivedAt: Date,
    lastStateChangeAt: Date,
    completionReason: String,
  },

  startDate: Date,
  endDate: Date,
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// ── Helpers ──────────────────────────────────────────────────────────

battleSchema.methods.calculateWinner = function () {
  if (this.entries.length < 2) return null;

  const voteCounts = {};
  this.votes.forEach((vote) => {
    const participantId = vote.votedFor?.toString();
    if (!participantId) return;
    voteCounts[participantId] = (voteCounts[participantId] || 0) + 1;
  });

  let winner = null;
  let maxVotes = 0;

  this.entries.forEach((entry) => {
    const participantId = entry.user?.toString();
    const votes = participantId ? voteCounts[participantId] || 0 : 0;
    entry.score = votes;
    if (votes > maxVotes) {
      maxVotes = votes;
      winner = entry.user;
    }
  });

  this.winner = winner;
  this.status = 'completed';
  this.completedAt = new Date();

  return this.save();
};

/**
 * Vérifie si la deadline de soumission (24 h) est dépassée.
 */
battleSchema.methods.isSubmissionExpired = function () {
  if (!this.submissionDeadline) return false;
  return Date.now() > this.submissionDeadline.getTime();
};

/**
 * Vérifie si la période de vote (6 j) est terminée.
 */
battleSchema.methods.isVotingExpired = function () {
  if (!this.voteDeadline) return false;
  return Date.now() > this.voteDeadline.getTime();
};

battleSchema.statics.SUBMISSION_WINDOW_MS = SUBMISSION_WINDOW_MS;
battleSchema.statics.VOTING_WINDOW_MS = VOTING_WINDOW_MS;

battleSchema.pre('validate', function normalizeBattleCategories(next) {
  const payload = buildDisciplinePayload(
    this.categories?.length ? this.categories : this.primaryCategory || this.category,
    { fallback: buildDisciplinePayload(null).categories }
  );

  this.categories = payload.categories;
  this.primaryCategory = payload.primaryCategory;
  next();
});

// ── Indexes for cron queries and API performance ─────────────────────
battleSchema.index({ status: 1, submissionDeadline: 1 });
battleSchema.index({ status: 1, voteDeadline: 1 });
battleSchema.index({ status: 1, createdAt: -1 });
battleSchema.index({ categories: 1, status: 1, voteDeadline: 1 });
battleSchema.index({ creator: 1 });
battleSchema.index({ challenger: 1 });

module.exports = mongoose.model('Battle', battleSchema);