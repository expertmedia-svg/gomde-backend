require('dotenv').config();

const mongoose = require('mongoose');
const User = require('../models/user');

const email = String(process.argv[2] || '').trim().toLowerCase();
const nextPassword = String(process.env.RESET_USER_PASSWORD || '');

const run = async () => {
  if (!email || !email.includes('@')) {
    throw new Error('Usage: npm run reset:user-password -- utilisateur@exemple.com');
  }
  if (nextPassword.length < 8) {
    throw new Error('Le nouveau mot de passe doit contenir au moins 8 caractères.');
  }

  await mongoose.connect(process.env.MONGODB_URI);
  const user = await User.findOne({ email }).select('+password isActive');
  if (!user) {
    throw new Error('Utilisateur introuvable.');
  }
  if (user.isActive === false) {
    throw new Error('Le compte est désactivé. Réactivez-le avant de modifier son mot de passe.');
  }

  user.password = nextPassword;
  await user.save();
  console.log('Mot de passe réinitialisé et chiffré : OK');
};

run()
  .catch((error) => {
    console.error('ECHEC:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined);
  });
