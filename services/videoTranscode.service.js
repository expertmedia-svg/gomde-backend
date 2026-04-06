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

  // Transcode to ultra-minimal WebM/VP8 for broken MediaTek hardware decoders
  // This device can't handle normal buffer allocation, so we reduce everything to minimum
  // Resolution: 320p (very low)
  // Bitrate: 500k (very low)
  // Keyframes: every frame (less buffering needed)
  await runFfmpeg([
    '-y',
    '-i',
    inputPath,
    '-vf',
    "scale='min(320,iw)':-2,format=yuv420p",  // Ultra low res
    '-c:v',
    'libvpx',          // VP8 video codec
    '-b:v',
    '500k',            // Ultra low bitrate
    '-maxrate',
    '750k',            // Low max rate
    '-minrate',
    '300k',            // Low min rate
    '-crf',
    '40',              // Lower quality (more compression)
    '-deadline',
    'realtime',        // Fastest encoding (less complex)
    '-g',
    '1',               // Keyframe every frame (no buffering)
    '-c:a',
    'libvorbis',       // Vorbis audio codec
    '-b:a',
    '64k',             // Lower audio bitrate
    '-ar',
    '16000',           // Very low sample rate
    '-ac',
    '1',               // Mono
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