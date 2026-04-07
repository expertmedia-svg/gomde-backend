const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

const ensureDirectory = async (targetPath) => {
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
};

const runFfmpeg = (args) => {
  return new Promise((resolve, reject) => {
    const process = spawn(ffmpegPath, args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    let stderr = '';
    process.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    process.on('error', (error) => {
      reject(error);
    });

    process.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`));
    });
  });
};

const createVideoThumbnail = async ({ inputPath, thumbnailPath }) => {
  await ensureDirectory(thumbnailPath);
  await runFfmpeg([
    '-y',
    '-i',
    inputPath,
    '-ss',
    '00:00:01.000',
    '-frames:v',
    '1',
    thumbnailPath,
  ]);
};

const safeUnlink = async (filePath) => {
  if (!filePath) {
    return;
  }

  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
};

const transcodeFeedVideo = async ({ inputPath, outputBasename }) => {
  if (!ffmpegPath) {
    throw new Error('ffmpeg-static is not available');
  }

  // MP4/H.264 : codec universel sur tous les appareils Android (y compris vieux MediaTek)
  // VP8/WebM causait des crashs sur les décodeurs matériels MediaTek (erreur ENOMEM -22)
  const outputPath = path.join(path.dirname(inputPath), `${outputBasename}.mp4`);
  const thumbnailPath = path.join(
    path.dirname(path.dirname(inputPath)),
    'thumbnails',
    `${outputBasename}.jpg`
  );

  await ensureDirectory(outputPath);
  await ensureDirectory(thumbnailPath);

  await runFfmpeg([
    '-y',
    '-i',
    inputPath,
    '-vf',
    "scale='min(480,iw)':-2,format=yuv420p",
    '-c:v',
    'libx264',         // H.264 : décodé nativement sur tous les Android
    '-preset',
    'fast',
    '-crf',
    '28',              // Qualité raisonnable
    '-maxrate',
    '1000k',
    '-bufsize',
    '2000k',
    '-movflags',
    '+faststart',      // Métadonnées au début pour le streaming
    '-c:a',
    'aac',             // AAC : audio universel
    '-b:a',
    '128k',
    '-ar',
    '44100',
    '-ac',
    '2',
    outputPath,
  ]);

  await createVideoThumbnail({ inputPath: outputPath, thumbnailPath });

  return {
    outputFilename: path.basename(outputPath),
    outputPath,
    thumbnailFilename: path.basename(thumbnailPath),
    thumbnailPath,
  };
};

module.exports = {
  createVideoThumbnail,
  transcodeFeedVideo,
  safeUnlink,
};