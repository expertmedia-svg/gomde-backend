const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

const AUDIO_DIRECTORY = path.join(__dirname, '..', 'uploads', 'audio');
const UPLOADS_PREFIX = '/uploads/';

const clamp = (value, minimum, maximum) => {
  const numericValue = Number(value);

  if (Number.isNaN(numericValue)) {
    return minimum;
  }

  return Math.min(maximum, Math.max(minimum, numericValue));
};

const resolveUploadedAudioPath = (audioUrl) => {
  if (!audioUrl || typeof audioUrl !== 'string' || !audioUrl.startsWith(UPLOADS_PREFIX)) {
    return null;
  }

  const relativePath = decodeURIComponent(audioUrl.slice(UPLOADS_PREFIX.length));
  return path.join(__dirname, '..', 'uploads', relativePath);
};

const runFfmpeg = (argumentsList) => new Promise((resolve, reject) => {
  const process = spawn(ffmpegPath, argumentsList, {
    windowsHide: true
  });

  let stderr = '';

  process.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  process.on('error', reject);
  process.on('close', (code) => {
    if (code === 0) {
      resolve();
      return;
    }

    reject(new Error(stderr || `ffmpeg exited with code ${code}`));
  });
});

exports.renderStudioMix = async ({
  rawVoicePath,
  instrumentalUrl,
  channelLevels = {},
  effects = {},
  timeline = {}
}) => {
  if (!rawVoicePath || !fs.existsSync(rawVoicePath)) {
    throw new Error('Raw voice file is missing');
  }

  if (!ffmpegPath) {
    throw new Error('ffmpeg-static is not available');
  }

  fs.mkdirSync(AUDIO_DIRECTORY, { recursive: true });

  const outputFileName = `mix-${Date.now()}-${Math.round(Math.random() * 1e9)}.m4a`;
  const outputPath = path.join(AUDIO_DIRECTORY, outputFileName);
  const instrumentalPath = resolveUploadedAudioPath(instrumentalUrl);

  const vocalLevel = clamp(channelLevels.leadVox ?? 82, 0, 200) / 100;
  const beatLevel = clamp(channelLevels.beat ?? 76, 0, 200) / 100;
  const reverbAmount = clamp(effects.reverb ?? 0, 0, 1);
  const autotuneAmount = clamp(effects.autotune ?? 0, 0, 1);
  const voiceOffsetMs = Math.round(clamp(timeline.voiceOffset ?? 0, 0, 12000));
  const trimStartSeconds = clamp(timeline.trimStart ?? 0, 0, 30000) / 1000;
  const trimEndSeconds = clamp(timeline.trimEnd ?? 0, 0, 30000) / 1000;

  const vocalFilters = [
    'aresample=44100',
    'highpass=f=120'
  ];

  if (trimStartSeconds > 0) {
    vocalFilters.push(`atrim=start=${trimStartSeconds.toFixed(3)}`);
  }

  if (trimEndSeconds > 0) {
    vocalFilters.push(`areverse,atrim=start=${trimEndSeconds.toFixed(3)},areverse`);
  }

  if (voiceOffsetMs > 0) {
    vocalFilters.push(`adelay=${voiceOffsetMs}:all=1`);
  }

  vocalFilters.push(`volume=${vocalLevel.toFixed(2)}`);
  vocalFilters.push('acompressor=threshold=0.12:ratio=2.5:attack=20:release=180');

  if (autotuneAmount > 0.05) {
    const delay = (45 + autotuneAmount * 20).toFixed(1);
    const decay = (0.20 + autotuneAmount * 0.20).toFixed(2);
    const speed = (0.12 + autotuneAmount * 0.18).toFixed(2);
    const depth = (1.8 + autotuneAmount * 3.2).toFixed(2);
    vocalFilters.push(`chorus=0.5:0.9:${delay}:${decay}:${speed}:${depth}`);
  }

  if (reverbAmount > 0.05) {
    const firstDelay = 90 + Math.round(reverbAmount * 180);
    const secondDelay = 170 + Math.round(reverbAmount * 260);
    const firstDecay = (0.22 + reverbAmount * 0.28).toFixed(2);
    const secondDecay = (0.16 + reverbAmount * 0.18).toFixed(2);
    vocalFilters.push(`aecho=0.8:0.7:${firstDelay}|${secondDelay}:${firstDecay}|${secondDecay}`);
  }

  const ffmpegArguments = ['-y', '-i', rawVoicePath];
  let filterComplex = `[0:a]${vocalFilters.join(',')}[vox]`;

  if (instrumentalPath && fs.existsSync(instrumentalPath)) {
    ffmpegArguments.push('-i', instrumentalPath);
    filterComplex = `${filterComplex};[1:a]aresample=44100,volume=${beatLevel.toFixed(2)}[beat];[beat][vox]amix=inputs=2:normalize=0:dropout_transition=0,alimiter=limit=0.95[out]`;
  } else {
    filterComplex = `${filterComplex};[vox]alimiter=limit=0.95[out]`;
  }

  ffmpegArguments.push(
    '-filter_complex',
    filterComplex,
    '-map',
    '[out]',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    outputPath
  );

  await runFfmpeg(ffmpegArguments);

  return {
    fileName: outputFileName,
    audioUrl: `/uploads/audio/${outputFileName}`
  };
};