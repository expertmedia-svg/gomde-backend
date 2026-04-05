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
    "scale='min(1280,iw)':-2,format=yuv420p",
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-profile:v',
    'high',
    '-level',
    '4.1',
    '-movflags',
    '+faststart',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
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