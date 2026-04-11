const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { applyAutotune, isAutotuneAvailable } = require('./autotune');

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
  if (!audioUrl || typeof audioUrl !== 'string') {
    return null;
  }

  let candidate = audioUrl;
  if (/^https?:\/\//i.test(candidate)) {
    try {
      candidate = new URL(candidate).pathname;
    } catch (error) {
      return null;
    }
  }

  const uploadsIndex = candidate.indexOf(UPLOADS_PREFIX);
  if (uploadsIndex === -1) {
    return null;
  }

  const relativePath = decodeURIComponent(candidate.slice(uploadsIndex + UPLOADS_PREFIX.length));
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
  channelPan = {},
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
  const autotuneWetMix = clamp(effects.autotune_wetMix ?? 1, 0, 1);
  const compressionAmount = clamp(effects.compression ?? 0.35, 0, 1);
  const lowEq = clamp(effects.lowEq ?? 0, -1, 1) * 10;
  const midEq = clamp(effects.midEq ?? 0, -1, 1) * 10;
  const highEq = clamp(effects.highEq ?? 0, -1, 1) * 10;
  const vocalPan = clamp(channelPan.leadVox ?? 0, -100, 100) / 100;
  const beatPan = clamp(channelPan.beat ?? 0, -100, 100) / 100;
  const voiceOffsetMs = Math.round(clamp(timeline.voiceOffset ?? 0, 0, 12000));
  const trimStartSeconds = clamp(timeline.trimStart ?? 0, 0, 30000) / 1000;
  const trimEndSeconds = clamp(timeline.trimEnd ?? 0, 0, 30000) / 1000;

  const vocalFilters = [
    'aresample=44100',
    'aformat=channel_layouts=stereo',
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
  if (Math.abs(lowEq) > 0.05) {
    vocalFilters.push(`equalizer=f=120:t=q:w=1.1:g=${lowEq.toFixed(2)}`);
  }
  if (Math.abs(midEq) > 0.05) {
    vocalFilters.push(`equalizer=f=1400:t=q:w=1.0:g=${midEq.toFixed(2)}`);
  }
  if (Math.abs(highEq) > 0.05) {
    vocalFilters.push(`equalizer=f=5200:t=q:w=0.8:g=${highEq.toFixed(2)}`);
  }

  if (Math.abs(vocalPan) > 0.01) {
    vocalFilters.push(`stereotools=balance_in=${vocalPan.toFixed(2)}`);
  }

  const compressionThreshold = Math.min(0.18, Math.max(0.05, 0.18 - compressionAmount * 0.1));
  const compressionRatio = (1.6 + compressionAmount * 3.6).toFixed(2);
  vocalFilters.push(
    `acompressor=threshold=${compressionThreshold.toFixed(2)}:ratio=${compressionRatio}:attack=20:release=180`
  );

  // SKIP chorus effect for autotune – will apply librosa autotune after mix
  // if (autotuneAmount > 0.05) { ... }

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
    const beatFilters = [
      'aresample=44100',
      'aformat=channel_layouts=stereo',
      `volume=${beatLevel.toFixed(2)}`,
    ];
    if (Math.abs(beatPan) > 0.01) {
      beatFilters.push(`stereotools=balance_in=${beatPan.toFixed(2)}`);
    }
    filterComplex = `${filterComplex};[1:a]${beatFilters.join(',')}[beat];[beat][vox]amix=inputs=2:normalize=0:dropout_transition=0,alimiter=limit=0.95[out]`;
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

  // Apply autotune with librosa if enabled
  if (autotuneAmount > 0.05) {
    try {
      const autotuneAvailable = await isAutotuneAvailable();
      
      if (autotuneAvailable) {
        // Python output will be .wav, then convert to .m4a
        const autotuneWavFileName = `autotune-wav-${Date.now()}-${Math.round(Math.random() * 1e9)}.wav`;
        const autotuneWavPath = path.join(AUDIO_DIRECTORY, autotuneWavFileName);
        const autotuneM4aPath = outputPath; // Reuse original m4a path
        
        // Get scale and root note from effects if provided (default to major, C)
        const scaleName = effects.autotune_scale || 'major';
        const rootNote = Math.round(effects.autotune_rootNote ?? 0);
        
        // Apply autotune (outputs WAV)
        await applyAutotune({
          inputPath: outputPath,
          outputPath: autotuneWavPath,
          strength: autotuneAmount,
          scale: scaleName,
          rootNote: rootNote,
          wetMix: autotuneWetMix
        });
        
        // Convert WAV to M4A
        await runFfmpeg([
          '-y',
          '-i', autotuneWavPath,
          '-c:a', 'aac',
          '-b:a', '192k',
          autotuneM4aPath
        ]);
        
        // Clean up intermediate WAV file
        if (fs.existsSync(autotuneWavPath)) {
          fs.unlinkSync(autotuneWavPath);
        }
        
        console.log(`[AUTOTUNE] Applied (strength=${autotuneAmount}, scale=${scaleName}, wetMix=${autotuneWetMix})`);
      } else {
        console.warn('[AUTOTUNE] Python/librosa not available, skipping autotune');
      }
    } catch (error) {
      console.error('[AUTOTUNE] Error:', error.message);
      console.warn('[AUTOTUNE] Continuing with mix without autotune');
    }
  }

  return {
    fileName: outputFileName,
    audioUrl: `/uploads/audio/${outputFileName}`
  };
};