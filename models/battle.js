const mongoose = require('mongoose');

const battleSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Battle title is required'],
    trim: true,
    maxlength: 100
  },
  description: String,
  creator: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  challenger: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'rejected', 'active', 'completed', 'cancelled'],
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
    text: String,
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  startDate: Date,
  endDate: Date,
  createdAt: {
    type: Date,
    default: Date.now
  }
});

battleSchema.methods.calculateWinner = function() {
  if (this.entries.length < 2) return null;
  
  const voteCounts = {};
  this.votes.forEach(vote => {
    voteCounts[vote.votedFor] = (voteCounts[vote.votedFor] || 0) + 1;
  });
  
  let winner = null;
  let maxVotes = 0;
  
  this.entries.forEach(entry => {
    const votes = voteCounts[entry.user] || 0;
    if (votes > maxVotes) {
      maxVotes = votes;
      winner = entry.user;
    }
  });
  
  this.winner = winner;
  this.status = 'completed';
  
  return this.save();
};

module.exports = mongoose.model('Battle', battleSchema);