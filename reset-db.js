/**
 * Script de réinitialisation de la base de données - Gomde
 * Supprime TOUTES les données excepté les comptes d'utilisateurs (identifiants, rôles, infos profil).
 * Réinitialise à 0 les scores, abonnés, et portefeuilles des utilisateurs.
 * Usage: node reset-db.js --yes
 */
require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

// Chargement des modèles
const User = require('./models/user');
const Video = require('./models/video');
const AudioTrack = require('./models/audioTrack');
const Battle = require('./models/battle');
const GomdeOr = require('./models/gomdeOr');
const ChampionSnapshot = require('./models/championSnapshot');
const GocoTransaction = require('./models/gocoTransaction');
const GocoWithdrawal = require('./models/gocoWithdrawal');
const Notification = require('./models/notification');
const SocialPost = require('./models/socialPost');

const confirmed = process.argv.slice(2).includes('--yes');

async function resetDatabase() {
  if (!confirmed) {
    console.error(
      'Ce script va supprimer TOUTES les battles, vidéos, posts, transactions, notifications, et réinitialiser les statistiques des utilisateurs.\n' +
      'Les identifiants et profils d\'utilisateurs seront CONSERVÉS.\n' +
      'Relance avec la confirmation explicite : node reset-db.js --yes'
    );
    process.exit(1);
  }

  try {
    console.log('Connexion à MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('Connecté à MongoDB');

    // 1. Suppression des collections transactionnelles/médias
    console.log('\nPurge des collections en cours...');
    const videoRes = await Video.deleteMany({});
    console.log(`- ${videoRes.deletedCount} vidéos supprimées.`);

    const audioRes = await AudioTrack.deleteMany({});
    console.log(`- ${audioRes.deletedCount} pistes audio supprimées.`);

    const battleRes = await Battle.deleteMany({});
    console.log(`- ${battleRes.deletedCount} battles supprimées.`);

    const gomdeOrRes = await GomdeOr.deleteMany({});
    console.log(`- ${gomdeOrRes.deletedCount} entrées Gomde d'Or supprimées.`);

    const snapshotRes = await ChampionSnapshot.deleteMany({});
    console.log(`- ${snapshotRes.deletedCount} instantanés de champions supprimés.`);

    const transactionRes = await GocoTransaction.deleteMany({});
    console.log(`- ${transactionRes.deletedCount} transactions GoCo supprimées.`);

    const withdrawalRes = await GocoWithdrawal.deleteMany({});
    console.log(`- ${withdrawalRes.deletedCount} demandes de retrait supprimées.`);

    const notificationRes = await Notification.deleteMany({});
    console.log(`- ${notificationRes.deletedCount} notifications supprimées.`);

    const socialPostRes = await SocialPost.deleteMany({});
    console.log(`- ${socialPostRes.deletedCount} posts réseau supprimés.`);

    // 2. Nettoyage physique des fichiers médias
    console.log('\nNettoyage physique des fichiers médias uploadés...');
    const uploadsDir = path.join(__dirname, 'uploads');
    let filesDeleted = 0;

    if (fs.existsSync(uploadsDir)) {
      const deleteFolderRecursive = (folderPath) => {
        const files = fs.readdirSync(folderPath);
        for (const file of files) {
          const curPath = path.join(folderPath, file);
          if (fs.lstatSync(curPath).isDirectory()) {
            deleteFolderRecursive(curPath);
          } else {
            try {
              fs.unlinkSync(curPath);
              filesDeleted++;
            } catch (_) {}
          }
        }
      };
      
      try {
        deleteFolderRecursive(uploadsDir);
        console.log(`- ${filesDeleted} fichiers physiques supprimés du dossier uploads.`);
      } catch (err) {
        console.error('Erreur lors du nettoyage physique des uploads:', err.message);
      }
    }

    // 3. Réinitialisation des statistiques et portefeuilles utilisateurs
    console.log('\nRéinitialisation des statistiques utilisateurs...');
    const userUpdateRes = await User.updateMany({}, {
      $set: {
        stats: {
          battles: { total: 0, wins: 0, losses: 0 },
          score: 0,
          followers: [],
          following: [],
          totalLikes: 0,
          totalViews: 0,
          totalShares: 0,
          totalBattleVotes: 0
        },
        savedContent: [],
        wallet: {
          balance: 0,
          lifetimeEarned: 0,
          pendingBalance: 0,
          lastRewardAt: null
        }
      }
    });
    console.log(`- ${userUpdateRes.modifiedCount} profils d'utilisateurs mis à jour.`);

    console.log('\nRéinitialisation de la base de données terminée avec succès !');
  } catch (error) {
    console.error('Erreur lors de la réinitialisation:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Déconnecté de MongoDB');
  }
}

resetDatabase();
