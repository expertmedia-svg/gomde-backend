/**
 * Migration - Renseigne `status: 'ready'` sur toutes les vidéos existantes
 * qui n'ont pas encore ce champ (créées avant l'introduction de l'upload
 * asynchrone). À exécuter UNE FOIS avant de déployer les changements qui
 * filtrent `status: 'ready'` dans les requêtes du feed/liste vidéos --
 * sinon toutes les vidéos existantes disparaissent des feeds au déploiement.
 * Usage: node migrate-video-status.js
 */
require('dotenv').config();
const mongoose = require('mongoose');

const Video = require('./models/video');

async function migrate() {
  try {
    console.log('Connexion à MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('Connecté à MongoDB');

    const missingCount = await Video.countDocuments({ status: { $exists: false } });
    console.log(`Vidéos sans champ status: ${missingCount}`);

    if (missingCount > 0) {
      const result = await Video.updateMany(
        { status: { $exists: false } },
        { $set: { status: 'ready' } }
      );
      console.log(`Migré ${result.modifiedCount} vidéos vers status:'ready'`);
    }

    const remaining = await Video.countDocuments({ status: { $exists: false } });
    console.log(`Restant sans status: ${remaining}`);

    if (remaining > 0) {
      console.error('ATTENTION: des vidéos sont encore sans status. Ne pas déployer les filtres status:ready avant de résoudre.');
      process.exitCode = 1;
    } else {
      console.log('Migration terminée avec succès.');
    }
  } catch (error) {
    console.error('Erreur lors de la migration:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    console.log('Déconnecté de MongoDB');
  }
}

migrate();
