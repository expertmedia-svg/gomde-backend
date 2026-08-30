require('dotenv').config();

const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const User = require('../models/user');

const email = String(process.argv[2] || '').trim().toLowerCase();

const run = async () => {
  if (!email || !email.includes('@')) {
    throw new Error('Usage: npm run diagnose:user-auth -- utilisateur@exemple.com');
  }

  await mongoose.connect(process.env.MONGODB_URI);
  const user = await User.findOne({ email }).select('+password email isActive lastLogin createdAt');

  if (!user) {
    console.log({ exists: false, action: 'Vérifier la base de production ou recréer le compte.' });
    return;
  }

  const storedPassword = String(user.password || '');
  const bcryptFormat = /^\$2[aby]\$\d{2}\$/.test(storedPassword);
  let bcryptRounds = null;
  if (bcryptFormat) {
    try {
      bcryptRounds = bcrypt.getRounds(storedPassword);
    } catch (_) {
      bcryptRounds = null;
    }
  }

  console.log({
    exists: true,
    active: user.isActive !== false,
    passwordFormat: bcryptFormat ? 'bcrypt' : storedPassword ? 'legacy-or-invalid' : 'missing',
    bcryptRounds,
    hasLoggedInBefore: Boolean(user.lastLogin),
    createdAt: user.createdAt || null,
  });
};

run()
  .catch((error) => {
    console.error('ECHEC:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined);
  });
