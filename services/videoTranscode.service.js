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

const transcodeMp4 = async ({ inputPath, outputPath, width, maxrate, audioBitrate }) => {
  await ensureDirectory(outputPath);
  await runFfmpeg([
    '-y', '-i', inputPath,
    '-vf', `scale='min(${width},iw)':-2,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '28',
    '-maxrate', maxrate, '-bufsize', `${parseInt(maxrate, 10) * 2}k`,
    '-movflags', '+faststart',
    '-c:a', 'aac', '-b:a', audioBitrate, '-ar', '44100', '-ac', '2',
    outputPath,
  ]);
};

const transcodeHlsVariant = async ({ inputPath, outputDir, name, width, bitrate }) => {
  const playlistPath = path.join(outputDir, `${name}.m3u8`);
  const segmentPattern = path.join(outputDir, `${name}-%04d.ts`);
  await runFfmpeg([
    '-y', '-i', inputPath,
    '-vf', `scale='min(${width},iw)':-2,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '28',
    '-maxrate', `${bitrate}k`, '-bufsize', `${bitrate * 2}k`,
    '-c:a', 'aac', '-b:a', width <= 240 ? '48k' : '96k', '-ac', '2',
    '-force_key_frames', 'expr:gte(t,n_forced*3)',
    '-hls_time', '3', '-hls_playlist_type', 'vod',
    '-hls_flags', 'independent_segments',
    '-hls_segment_filename', segmentPattern,
    playlistPath,
  ]);
  return playlistPath;
};

const createHlsPackage = async ({ inputPath, outputBasename }) => {
  const outputDir = path.join(path.dirname(inputPath), 'hls', outputBasename);
  await fs.promises.mkdir(outputDir, { recursive: true });
  await transcodeHlsVariant({ inputPath, outputDir, name: '240p', width: 240, bitrate: 350 });
  await transcodeHlsVariant({ inputPath, outputDir, name: '360p', width: 360, bitrate: 650 });
  await transcodeHlsVariant({ inputPath, outputDir, name: '480p', width: 480, bitrate: 1000 });
  const masterPath = path.join(outputDir, 'master.m3u8');
  await fs.promises.writeFile(
    masterPath,
    '#EXTM3U\n#EXT-X-VERSION:3\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=430000,RESOLUTION=240x426\n240p.m3u8\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=760000,RESOLUTION=360x640\n360p.m3u8\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=1120000,RESOLUTION=480x854\n480p.m3u8\n',
  );
  const names = await fs.promises.readdir(outputDir);
  return {
    masterPath,
    relativeDirectory: `hls/${outputBasename}`,
    files: names.map((fileName) => ({ fileName, filePath: path.join(outputDir, fileName) })),
  };
};

const transcodeFeedVideo = async ({ inputPath, outputBasename }) => {
  if (!ffmpegPath) {
    throw new Error('ffmpeg-static is not available');
  }

  // MP4/H.264 : codec universel sur tous les appareils Android (y compris vieux MediaTek)
  // VP8/WebM causait des crashs sur les décodeurs matériels MediaTek (erreur ENOMEM -22)
  const outputPath = path.join(path.dirname(inputPath), `${outputBasename}.mp4`);
  const lowOutputPath = path.join(path.dirname(inputPath), `${outputBasename}-low.mp4`);
  const thumbnailPath = path.join(
    path.dirname(path.dirname(inputPath)),
    'thumbnails',
    `${outputBasename}.jpg`
  );

  await ensureDirectory(thumbnailPath);

  await transcodeMp4({
    inputPath, outputPath, width: 480, maxrate: '1000k', audioBitrate: '96k',
  });
  await transcodeMp4({
    inputPath, outputPath: lowOutputPath, width: 240, maxrate: '350k', audioBitrate: '48k',
  });

  await createVideoThumbnail({ inputPath: outputPath, thumbnailPath });
  const hls = await createHlsPackage({ inputPath: outputPath, outputBasename });

  return {
    outputFilename: path.basename(outputPath),
    outputPath,
    lowOutputFilename: path.basename(lowOutputPath),
    lowOutputPath,
    thumbnailFilename: path.basename(thumbnailPath),
    thumbnailPath,
    hls,
  };
};

module.exports = {
  createVideoThumbnail,
  transcodeFeedVideo,
  safeUnlink,
};
