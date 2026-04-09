const mongoose = require('mongoose');

// ── GOMDE D'OR 2026 — Compétition nationale de rap battle ───────────
// Phases : inscription (auto dès 1er sept) → qualifications provinciales
// → demi-finales → finale nationale → couronnement du Roi de l'Arène

const EDITION_YEAR = 2026;
const REGISTRATION_START = new Date('2026-09-01T00:00:00Z');
const REGISTRATION_END = new Date('2026-10-31T23:59:59Z');

// ── Provinces / Régions du Burkina ──────────────────────────────────
const PROVINCES = [
  'Centre', 'Hauts-Bassins', 'Centre-Ouest', 'Cascades', 'Nord',
  'Est', 'Sahel', 'Boucle du Mouhoun', 'Sud-Ouest', 'Centre-Est',
  'Centre-Nord', 'Centre-Sud', 'Plateau-Central'
];

// Quartiers éligibles pour le classement local (Ouaga + Bobo)
const CITY_NEIGHBORHOODS = {
  'Ouagadougou': [
    'Karpala', 'Tampouy', 'Gounghin', 'Wemtenga', 'Tanghin',
    'Dassasgho', 'Pissy', 'Patte d\'Oie', 'Wayalghin', 'Rimkièta'
  ],
  'Bobo-Dioulasso': [
    'Kuinima', 'Belleville', 'Sarfalao', 'Lafiabougou', 'Bindougousso',
    'Dogona', 'Colsama', 'Accart-Ville', 'Tounouma', 'Diarradougou'
  ]
};

// ── Schema : inscription au championnat ─────────────────────────────
const championshipEntrySchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  province: {
    type: String,
    enum: PROVINCES,
    required: true
  },
  city: {
    type: String,
    required: true
  },
  neighborhood: String,

  // Points accumulés pendant la compétition
  points: { type: Number, default: 0 },
  wins: { type: Number, default: 0 },
  losses: { type: Number, default: 0 },
  totalBattles: { type: Number, default: 0 },
  totalVotesReceived: { type: Number, default: 0 },

  // Classements finaux
  provinceRank: Number,
  neighborhoodRank: Number,
  nationalRank: Number,

  // Trophées gagnés
  trophies: [{
    type: {
      type: String,
      enum: [
        'neighborhood_champion',   // 1er du quartier (Ouaga/Bobo uniquement)
        'province_1st',            // 1er de la province
        'province_2nd',            // 2ème de la province
        'national_finalist',       // Finaliste national
        'national_champion',       // GOMDE D'OR — Roi de l'Arène
        'national_runner_up'       // 2ème national
      ]
    },
    label: String,
    awardedAt: { type: Date, default: Date.now }
  }],

  registeredAt: { type: Date, default: Date.now },
  isAutoRegistered: { type: Boolean, default: false }
});

// ── Schema principal : Édition GOMDE D'OR ───────────────────────────
const gomdeOrSchema = new mongoose.Schema({
  year: {
    type: Number,
    required: true,
    unique: true,
    default: EDITION_YEAR
  },
  title: {
    type: String,
    default: `GOMDE D'OR ${EDITION_YEAR}`
  },
  description: {
    type: String,
    default: 'Championnat national de rap battle du Burkina Faso. Devenez le Roi de l\'Arène GOMDE !'
  },
  status: {
    type: String,
    enum: ['upcoming', 'registration', 'qualifications', 'semifinals', 'finals', 'completed'],
    default: 'upcoming'
  },

  // Dates clés
  registrationStart: { type: Date, default: REGISTRATION_START },
  registrationEnd: { type: Date, default: REGISTRATION_END },
  qualificationsStart: Date,
  qualificationsEnd: Date,
  semifinalsStart: Date,
  semifinalsEnd: Date,
  finalsDate: Date,
  ceremonyDate: Date,

  // Participants inscrits
  entries: [championshipEntrySchema],

  // Battles officiels liés au championnat
  battles: [{
    battle: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Battle'
    },
    phase: {
      type: String,
      enum: ['qualification', 'semifinal', 'final']
    },
    province: String,
    neighborhood: String,
    createdAt: { type: Date, default: Date.now }
  }],

  // Résultats finaux
  nationalChampion: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  nationalRunnerUp: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  // Classement par province : [{province, first, second}]
  provinceResults: [{
    province: String,
    first: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    second: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  }],

  // Classement par quartier (Ouaga + Bobo uniquement)
  neighborhoodResults: [{
    city: String,
    neighborhood: String,
    champion: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  }],

  prizes: {
    nationalChampion: { type: String, default: 'Trophée GOMDE D\'OR + Titre Roi de l\'Arène' },
    nationalRunnerUp: { type: String, default: 'Trophée GOMDE D\'ARGENT' },
    provinceFirst: { type: String, default: 'Champion Provincial' },
    provinceSecond: { type: String, default: 'Vice-Champion Provincial' },
    neighborhoodChampion: { type: String, default: 'Champion du Quartier' }
  },

  createdAt: { type: Date, default: Date.now }
});

// ── Méthodes ────────────────────────────────────────────────────────

/**
 * Inscrit automatiquement un utilisateur à partir de son profil.
 * Si l'utilisateur est déjà inscrit, ne fait rien.
 */
gomdeOrSchema.methods.autoRegisterUser = function (user) {
  const existingEntry = this.entries.find(
    (e) => e.user.toString() === user._id.toString()
  );
  if (existingEntry) return existingEntry;

  const province = user.profile?.region;
  const city = user.profile?.city;
  if (!province || !city) return null;

  const entry = {
    user: user._id,
    province,
    city,
    neighborhood: user.profile.neighborhood || null,
    isAutoRegistered: true
  };

  this.entries.push(entry);
  return this.entries[this.entries.length - 1];
};

/**
 * Met à jour les points d'un participant après une battle.
 */
gomdeOrSchema.methods.updateParticipantScore = function (userId, isWinner, votesReceived = 0) {
  const entry = this.entries.find(
    (e) => e.user.toString() === userId.toString()
  );
  if (!entry) return;

  entry.totalBattles += 1;
  entry.totalVotesReceived += votesReceived;

  if (isWinner) {
    entry.wins += 1;
    entry.points += 100; // victoire
  } else {
    entry.losses += 1;
    entry.points += 25; // participation
  }

  // Bonus votes
  entry.points += votesReceived * 5;
};

/**
 * Calcule les classements par province et quartier.
 */
gomdeOrSchema.methods.calculateRankings = function () {
  // Classement par province
  const byProvince = {};
  this.entries.forEach((e) => {
    if (!byProvince[e.province]) byProvince[e.province] = [];
    byProvince[e.province].push(e);
  });

  this.provinceResults = [];
  for (const [province, participants] of Object.entries(byProvince)) {
    participants.sort((a, b) => b.points - a.points);
    participants.forEach((p, i) => { p.provinceRank = i + 1; });

    if (participants.length >= 1) {
      this.provinceResults.push({
        province,
        first: participants[0].user,
        second: participants.length >= 2 ? participants[1].user : null
      });
    }
  }

  // Classement par quartier (Ouaga + Bobo)
  this.neighborhoodResults = [];
  for (const [cityName, neighborhoods] of Object.entries(CITY_NEIGHBORHOODS)) {
    for (const nh of neighborhoods) {
      const nhParticipants = this.entries.filter(
        (e) => e.city === cityName && e.neighborhood === nh
      );
      if (nhParticipants.length === 0) continue;
      nhParticipants.sort((a, b) => b.points - a.points);
      nhParticipants.forEach((p, i) => { p.neighborhoodRank = i + 1; });

      this.neighborhoodResults.push({
        city: cityName,
        neighborhood: nh,
        champion: nhParticipants[0].user
      });
    }
  }

  // Classement national
  const allSorted = [...this.entries].sort((a, b) => b.points - a.points);
  allSorted.forEach((p, i) => { p.nationalRank = i + 1; });

  if (allSorted.length >= 1) this.nationalChampion = allSorted[0].user;
  if (allSorted.length >= 2) this.nationalRunnerUp = allSorted[1].user;
};

// ── Index ────────────────────────────────────────────────────────────
gomdeOrSchema.index({ year: 1 });
gomdeOrSchema.index({ 'entries.user': 1 });
gomdeOrSchema.index({ 'entries.province': 1, 'entries.points': -1 });
gomdeOrSchema.index({ status: 1 });

module.exports = mongoose.model('GomdeOr', gomdeOrSchema);
module.exports.PROVINCES = PROVINCES;
module.exports.CITY_NEIGHBORHOODS = CITY_NEIGHBORHOODS;
module.exports.REGISTRATION_START = REGISTRATION_START;
module.exports.REGISTRATION_END = REGISTRATION_END;
