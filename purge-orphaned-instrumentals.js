/**
 * Nettoyage ponctuel - Supprime les fiches AudioTrack (instrumental: true)
 * dont le fichier audio n'existe plus sur le disque (dossier uploads/instru/
 * synchronisé ou upload individuel via l'admin dans uploads/audio/). Ces
 * fiches fantômes font échouer le téléchargement du beat (404) pour tous les
 * utilisateurs qui tentent de le sélectionner dans le Studio.
 *
 * Réutilise la même logique que le nettoyage automatique appelé à chaque
 * GET /api/studio/instrumentals (studio.controller.js::purgeOrphanedInstrumentals)
 * -- ce script sert juste à nettoyer immédiatement sans attendre un appel API.
 *
 * Usage: node purge-orphaned-instrumentals.js
 */
require('dotenv').config();
const mongoose = require('mongoose');

const { purgeOrphanedInstrumentals } = require('./controllers/studio.controller');

async function run() {
  try {
    console.log('Connexion à MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('Connecté à MongoDB');

    const { checked, purged } = await purgeOrphanedInstrumentals();

    console.log(`Instrumentaux vérifiés: ${checked}`);
    console.log(`Fiches fantômes supprimées: ${purged}`);

    if (purged > 0) {
      console.log('Nettoyage terminé. Re-uploader les vrais fichiers via l\'admin pour repeupler le catalogue.');
    } else {
      console.log('Aucune fiche orpheline trouvée.');
    }
  } catch (error) {
    console.error('Erreur lors du nettoyage:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    console.log('Déconnecté de MongoDB');
  }
}

run();
