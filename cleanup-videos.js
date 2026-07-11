/**
 * Script de nettoyage - Supprime TOUTES les vidéos et TOUS les enregistrements
 * audio de type "recording" (ainsi que leurs fichiers sur disque). Destructeur
 * et irréversible : jamais de dry-run, jamais de filtre par utilisateur/date.
 * Usage: node cleanup-videos.js --yes
 */
require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const Video = require('./models/video');
const AudioTrack = require('./models/audiotrack');

const confirmed = process.argv.slice(2).includes('--yes');

async function cleanup() {
  if (process.env.NODE_ENV === 'production') {
    console.error(
      'Refusé : NODE_ENV=production. Ce script supprime tout le contenu ' +
      'utilisateur de façon irréversible et ne doit jamais tourner contre une base de production.'
    );
    process.exit(1);
  }

  if (!confirmed) {
    console.error(
      'Ce script va supprimer TOUTES les vidéos et TOUS les enregistrements ' +
      'audio de type "recording", plus leurs fichiers sur disque. Action irréversible.\n' +
      'Relance avec la confirmation explicite : node cleanup-videos.js --yes'
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

    // Compter avant suppression
    const videoCount = await Video.countDocuments();
    const audioCount = await AudioTrack.countDocuments({ sourceType: 'recording' });

    console.log(`\nTrouvé:`);
    console.log(`  - ${videoCount} vidéos`);
    console.log(`  - ${audioCount} enregistrements audio (recordings)`);

    // Récupérer les URLs des fichiers pour nettoyage physique
    const videos = await Video.find().select('videoUrl thumbnailUrl');
    const audios = await AudioTrack.find({ sourceType: 'recording' }).select('audioUrl');

    // Supprimer les documents MongoDB
    const videoResult = await Video.deleteMany({});
    const audioResult = await AudioTrack.deleteMany({ sourceType: 'recording' });

    console.log(`\nSupprimé de MongoDB:`);
    console.log(`  - ${videoResult.deletedCount} vidéos`);
    console.log(`  - ${audioResult.deletedCount} enregistrements audio`);

    // Tenter de supprimer les fichiers physiques
    let filesDeleted = 0;
    const uploadsDir = path.join(__dirname, 'uploads');

    for (const video of videos) {
      if (video.videoUrl) {
        const filePath = path.join(uploadsDir, video.videoUrl.replace(/^\/uploads\//, ''));
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          filesDeleted++;
        }
      }
      if (video.thumbnailUrl) {
        const filePath = path.join(uploadsDir, video.thumbnailUrl.replace(/^\/uploads\//, ''));
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          filesDeleted++;
        }
      }
    }

    for (const audio of audios) {
      if (audio.audioUrl) {
        const filePath = path.join(uploadsDir, audio.audioUrl.replace(/^\/uploads\//, ''));
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          filesDeleted++;
        }
      }
    }

    console.log(`  - ${filesDeleted} fichiers physiques supprimés`);

    console.log('\nNettoyage terminé avec succès !');
  } catch (error) {
    console.error('Erreur lors du nettoyage:', error.message);
  } finally {
    await mongoose.disconnect();
    console.log('Déconnecté de MongoDB');
  }
}

cleanup();
