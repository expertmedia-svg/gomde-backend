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

  // Generate WebM (VP8) instead of MP4 (H.264) for better mobile compatibility
  // VP8 is software-decoded on all Android devices, avoiding hardware codec issues
  const outputPath = path.join(path.dirname(inputPath), `${outputBasename}.webm`);
  const thumbnailPath = path.join(
    path.dirname(path.dirname(inputPath)),
    'thumbnails',
    `${outputBasename}.jpg`
  );

  await ensureDirectory(outputPath);
  await ensureDirectory(thumbnailPath);

  // Transcode to WebM/VP8 format
  // VP8 is the best choice for mobile hardware compatibility:
  // - No hardware decoder dependency (all Android devices use software decode)
  // - Lower CPU requirements than VP9
  // - Universal browser and Android support
  await runFfmpeg([
    '-y',
    '-i',
    inputPath,
    '-vf',
    "scale='min(480,iw)':-2,format=yuv420p",
    '-c:v',
    'libvpx',          // VP8 video codec
    '-b:v',
    '1500k',           // Target bitrate
    '-maxrate',
    '2000k',           // Maximum bitrate
    '-minrate',
    '1000k',           // Minimum bitrate
    '-crf',
    '32',              // Quality (higher = lower quality, 1-63)
    '-deadline',
    'good',            // Encoding speed (best, good, realtime)
    '-g',
    '120',             // Keyframe interval (for VP8)
    '-c:a',
    'libvorbis',       // Vorbis audio codec
    '-b:a',
    '96k',             // Audio bitrate
    '-ar',
    '22050',           // Audio sample rate
    '-ac',
    '2',               // Audio channels
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