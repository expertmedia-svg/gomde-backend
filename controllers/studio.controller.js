const AudioTrack = require('../models/audiotrack');
const path = require('path');
const fs = require('fs');
const { buildDisciplinePayload } = require('../constants/disciplines');
const { buildFileIntegrity } = require('../services/fileIntegrity.service');
const { renderStudioMix } = require('../services/audioMix.service');
const { grantGocoReward } = require('../services/goco.service');
const { deleteStoredFile, uploadLocalFile } = require('../services/mediaStorage.service');
const { recomputeUserScoreById } = require('../services/score.service');
const { createSharePost, syncPublicationPost } = require('../services/social.service');

const safeRemoveStudioFile = async (filePath) => {
  if (!filePath) {
    return;
  }

  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }
};

const resolveStudioUploadPath = (value, subdirectory) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }

  const candidate = value.trim();
  let fileName = candidate;

  try {
    if (candidate.startsWith('http://') || candidate.startsWith('https://')) {
      fileName = decodeURIComponent(new URL(candidate).pathname.split('/').pop() || '');
    } else {
      fileName = decodeURIComponent(path.basename(candidate));
    }
  } catch (error) {
    fileName = path.basename(candidate);
  }

  if (!fileName) {
    return null;
  }

  return path.join(__dirname, '..', 'uploads', subdirectory, fileName);
};

const findRecordingById = (recordingId) => AudioTrack.findOne({
  _id: recordingId,
  instrumental: false,
}).populate('user', 'username profile.city profile.neighborhood profile.avatar');

const INSTRU_DIRECTORY = path.join(__dirname, '..', 'uploads', 'instru');
const SUPPORTED_AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.webm']);

const inferGenre = (fileName) => {
  const normalized = fileName.toLowerCase();

  if (normalized.includes('drill')) return 'Drill';
  if (normalized.includes('dancehall') || normalized.includes('shatta')) return 'Dancehall';
  if (normalized.includes('reggae')) return 'Reggae';
  if (normalized.includes('gospel')) return 'Gospel';
  if (normalized.includes('boom bap') || normalized.includes('boom bap')) return 'Boom Bap';
  if (normalized.includes('trap')) return 'Trap';
  if (normalized.includes('afro')) return 'Afro';
  if (normalized.includes('hip hop')) return 'Hip Hop';

  return 'Freestyle';
};

const inferBpm = (genre) => {
  switch (genre) {
    case 'Drill': return 142;
    case 'Dancehall': return 98;
    case 'Reggae': return 92;
    case 'Boom Bap': return 90;
    case 'Trap': return 140;
    case 'Afro': return 110;
    default: return 100;
  }
};

const sanitizeTitleFromFile = (fileName) => path.basename(fileName, path.extname(fileName))
  .replace(/[_]+/g, ' ')
  .replace(/[\[\]()]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const safeJsonParse = (value, fallback) => {
  if (!value) return fallback;

  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
};

const syncInstrumentalsFromFolder = async () => {
  if (!fs.existsSync(INSTRU_DIRECTORY)) {
    return;
  }

  const files = fs.readdirSync(INSTRU_DIRECTORY)
    .filter((fileName) => {
      const extension = path.extname(fileName).toLowerCase();
      return SUPPORTED_AUDIO_EXTENSIONS.has(extension);
    });

  if (files.length === 0) {
    return;
  }

  await AudioTrack.deleteMany({
    instrumental: true,
    sourceType: 'folder',
    sourceFileName: { $nin: files }
  });

  const existingTracks = await AudioTrack.find({
    instrumental: true,
    sourceType: 'folder',
    sourceFileName: { $in: files }
  }).select('sourceFileName');

  const existingFileNames = new Set(existingTracks.map((track) => track.sourceFileName));

  const missingTracks = files
    .filter((fileName) => !existingFileNames.has(fileName))
    .map((fileName) => {
      const genre = inferGenre(fileName);

      return {
        title: sanitizeTitleFromFile(fileName),
        artist: 'Catalogue GOMDE',
        genre,
        bpm: inferBpm(genre),
        audioUrl: `/uploads/instru/${encodeURIComponent(fileName)}`,
        instrumental: true,
        isPublic: true,
        sourceType: 'folder',
        sourceFileName: fileName,
        createdAt: fs.statSync(path.join(INSTRU_DIRECTORY, fileName)).mtime
      };
    });

  if (missingTracks.length > 0) {
    await AudioTrack.insertMany(missingTracks);
  }
};

exports.getInstrumentals = async (req, res) => {
  try {
    const { genre, page = 1, limit = 20 } = req.query;
    await syncInstrumentalsFromFolder();

    const query = { instrumental: true, isPublic: true };
    
    if (genre) query.genre = genre;
    
    const tracks = await AudioTrack.find(query)
      .sort({ plays: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);
    
    res.json(tracks);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.saveAudioRecording = async (req, res) => {
  try {
    const mixFile = req.files?.audio?.[0];
    const rawVoiceFile = req.files?.rawVoice?.[0];
    
    const {
      title,
      instrumentalId,
      effects,
      channelLevels,
      channelPan,
      recordingSetup,
      shareToCommunity,
      sourceRecordingId,
      timeline,
      renderMix,
      previewMix
    } = req.body;
    const parsedEffects = safeJsonParse(effects, {
      reverb: 0,
      autotune: 0,
      compression: 0.35,
      lowEq: 0,
      midEq: 0,
      highEq: 0
    });
    const parsedLevels = safeJsonParse(channelLevels, { leadVox: 82, double: 64, beat: 76, fxBus: 48 });
    const parsedPan = safeJsonParse(channelPan, { leadVox: 0, double: -20, beat: 0, fxBus: 16 });
    const parsedSetup = safeJsonParse(recordingSetup, {
      sampleRate: 44100,
      channels: 1,
      stereoEnabled: false
    });
    const parsedTimeline = safeJsonParse(timeline, {
      voiceOffset: 0,
      trimStart: 0,
      trimEnd: 0,
      duration: 0,
      currentPosition: 0,
      zoom: 1,
      loopEnabled: false,
      loopStart: 0,
      loopEnd: 0,
      sections: []
    });
    const sanitizedTimeline = {
      voiceOffset: Number(parsedTimeline.voiceOffset) || 0,
      trimStart: Number(parsedTimeline.trimStart) || 0,
      trimEnd: Number(parsedTimeline.trimEnd) || 0,
      duration: Number(parsedTimeline.duration) || 0,
      currentPosition: Number(parsedTimeline.currentPosition) || 0,
      zoom: Number(parsedTimeline.zoom) || 1,
      loopEnabled: parsedTimeline.loopEnabled === true,
      loopStart: Number(parsedTimeline.loopStart) || 0,
      loopEnd: Number(parsedTimeline.loopEnd) || 0,
      sections: Array.isArray(parsedTimeline.sections)
        ? parsedTimeline.sections.map((section) => ({
            label: section?.label || 'Section',
            start: Number(section?.start) || 0,
            end: Number(section?.end) || 0,
            color: section?.color || '#FFFFFF'
          }))
        : []
    };
    const selectedInstrumental = instrumentalId ? await AudioTrack.findById(instrumentalId) : null;
    const shouldRenderMix = renderMix === true || renderMix === 'true';
    const isPreviewMix = previewMix === true || previewMix === 'true';
    const normalizedCategories = buildDisciplinePayload(selectedInstrumental?.categories || selectedInstrumental?.primaryCategory || selectedInstrumental?.genre);

    if (!mixFile && !rawVoiceFile) {
      return res.status(400).json({ message: 'No audio source uploaded' });
    }

    const finalIntegritySource = mixFile || rawVoiceFile;
    const uploadIntegrity = await buildFileIntegrity(finalIntegritySource);

    let finalAudioUrl = mixFile ? `/uploads/audio/${mixFile.filename}` : null;
    let finalAudioFileName = mixFile?.filename || null;

    if (shouldRenderMix && rawVoiceFile) {
      const renderedMix = await renderStudioMix({
        rawVoicePath: path.join(__dirname, '..', 'uploads', 'audio', rawVoiceFile.filename),
        instrumentalUrl: selectedInstrumental?.audioUrl,
        channelLevels: parsedLevels,
        channelPan: parsedPan,
        effects: parsedEffects,
        timeline: sanitizedTimeline
      });

      finalAudioUrl = renderedMix.audioUrl;
      finalAudioFileName = renderedMix.fileName;
    }

    if (!finalAudioUrl && rawVoiceFile) {
      finalAudioUrl = `/uploads/audio/${rawVoiceFile.filename}`;
      finalAudioFileName = rawVoiceFile.filename;
    }

    if (!finalAudioUrl) {
      return res.status(400).json({ message: 'Unable to render or resolve the final mix' });
    }

    const storedFinalAudio = finalAudioFileName
      ? await uploadLocalFile({
          req,
          localPath: path.join(__dirname, '..', 'uploads', 'audio', finalAudioFileName),
          subdirectory: 'audio',
          fileName: finalAudioFileName,
          contentType: mixFile?.mimetype || rawVoiceFile?.mimetype || 'audio/mp4',
        })
      : null;

    const persistedAudioUrl = storedFinalAudio?.publicUrl || finalAudioUrl;

    if (isPreviewMix) {
      return res.json({
        preview: true,
        audioUrl: persistedAudioUrl,
        title: title || 'Préécoute studio',
        metadata: {
          effects: parsedEffects,
          channelLevels: parsedLevels,
          channelPan: parsedPan,
          instrumentalId: selectedInstrumental?._id,
          instrumentalTitle: selectedInstrumental?.title,
          instrumentalUrl: selectedInstrumental?.audioUrl,
          rawVoiceUrl: rawVoiceFile ? `/uploads/audio/${rawVoiceFile.filename}` : undefined,
          timeline: sanitizedTimeline,
        },
      });
    }
    
    const track = await AudioTrack.create({
      title: title || `Session studio ${new Date().toLocaleDateString('fr-FR')}`,
      artist: req.user.username,
      genre: selectedInstrumental?.genre || 'Freestyle',
      primaryCategory: normalizedCategories.primaryCategory,
      categories: normalizedCategories.categories,
      bpm: selectedInstrumental?.bpm,
      user: req.user._id,
      audioUrl: persistedAudioUrl,
      uploadChecksum: uploadIntegrity?.checksum || '',
      uploadSizeBytes: uploadIntegrity?.sizeBytes || 0,
      uploadMimeType: uploadIntegrity?.mimeType || '',
      instrumental: false,
      isPublic: shareToCommunity === true || shareToCommunity === 'true',
      shareToCommunity: shareToCommunity === true || shareToCommunity === 'true',
      sourceType: 'recording',
      metadata: {
        effects: parsedEffects,
        channelLevels: parsedLevels,
        channelPan: parsedPan,
        recordingSetup: parsedSetup,
        instrumentalId: selectedInstrumental?._id,
        instrumentalTitle: selectedInstrumental?.title,
        instrumentalUrl: selectedInstrumental?.audioUrl,
        rawVoiceUrl: rawVoiceFile ? `/uploads/audio/${rawVoiceFile.filename}` : undefined,
        rawVoiceFileName: rawVoiceFile?.originalname,
        rawVoiceMimeType: rawVoiceFile?.mimetype,
        timeline: sanitizedTimeline,
        sourceRecordingId: sourceRecordingId || undefined
      }
    });
    
    // Update instrumental plays if used
    if (instrumentalId) {
      await AudioTrack.findByIdAndUpdate(instrumentalId, {
        $inc: { plays: 1 }
      });
    }
    
    const populatedTrack = await AudioTrack.findById(track._id)
      .populate('user', 'username profile.city profile.neighborhood');

    res.status(201).json(populatedTrack);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.uploadInstrumental = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Only the GOMDE team can publish official instrumentals' });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'No audio file uploaded' });
    }

    const { title, genre, bpm } = req.body;

    if (!title) {
      return res.status(400).json({ message: 'Title is required' });
    }

    const track = await AudioTrack.create({
      title,
      artist: 'Catalogue GOMDE',
      genre: genre || 'Various',
      bpm: bpm ? Number(bpm) : undefined,
      audioUrl: (
        await uploadLocalFile({
          req,
          localPath: req.file.path,
          subdirectory: 'audio',
          fileName: req.file.filename,
          contentType: req.file.mimetype,
        })
      ).publicUrl,
      instrumental: true,
      user: req.user._id,
      isPublic: true
    });

    res.status(201).json(track);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.getUserRecordings = async (req, res) => {
  try {
    const recordings = await AudioTrack.find({
      user: req.user._id,
      instrumental: false
    })
      .populate('user', 'username profile.city profile.neighborhood')
      .sort({ createdAt: -1 });
    
    res.json(recordings);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.getCommunityRecordings = async (req, res) => {
  try {
    const recordings = await AudioTrack.find({
      instrumental: false,
      shareToCommunity: true,
      isPublic: true
    })
      .populate('user', 'username profile.city profile.neighborhood')
      .sort({ createdAt: -1 })
      .limit(24);

    res.json(recordings);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.publishRecording = async (req, res) => {
  try {
    const recording = await AudioTrack.findOne({
      _id: req.params.id,
      user: req.user._id,
      instrumental: false
    }).populate('user', 'username profile.city profile.neighborhood');

    if (!recording) {
      return res.status(404).json({ message: 'Recording not found' });
    }

    // Save cover image if provided
    if (req.file) {
      recording.coverImageUrl = (
        await uploadLocalFile({
          req,
          localPath: req.file.path,
          subdirectory: 'covers',
          fileName: req.file.filename,
          contentType: req.file.mimetype,
        })
      ).publicUrl;
    }

    recording.shareToCommunity = true;
    recording.isPublic = true;
    await recording.save();

    await syncPublicationPost({
      authorId: req.user._id,
      targetType: 'audio',
      targetId: recording._id,
      text: recording.description || recording.title,
    });

    res.json(recording);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.incrementRecordingPlay = async (req, res) => {
  try {
    const recording = await findRecordingById(req.params.id);

    if (!recording || !recording.shareToCommunity || !recording.isPublic) {
      return res.status(404).json({ message: 'Recording not found' });
    }

    recording.plays += 1;
    await recording.save();

    if (recording.user?._id) {
      await AudioTrack.db.model('User').findByIdAndUpdate(recording.user._id, {
        $inc: { 'stats.totalViews': 1 }
      });
      await recomputeUserScoreById(recording.user._id);
      await grantGocoReward({
        userId: recording.user._id,
        actorId: req.user?._id || null,
        actionType: 'audio_play',
        targetType: 'audio',
        targetId: recording._id,
        metadata: { title: recording.title },
        eventKey: `audio_play:${recording._id}:${req.user?._id || req.ip}:${new Date().toISOString().slice(0, 10)}`,
      });
    }

    res.json({ plays: recording.plays });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.toggleRecordingLike = async (req, res) => {
  try {
    const recording = await findRecordingById(req.params.id);

    if (!recording || !recording.shareToCommunity || !recording.isPublic) {
      return res.status(404).json({ message: 'Recording not found' });
    }

    const existingIndex = recording.likes.findIndex(
      (entry) => entry.toString() === req.user._id.toString()
    );
    const liked = existingIndex === -1;

    if (liked) {
      recording.likes.push(req.user._id);
    } else {
      recording.likes.splice(existingIndex, 1);
    }

    await recording.save();

    if (recording.user?._id) {
      await AudioTrack.db.model('User').findByIdAndUpdate(recording.user._id, {
        $inc: { 'stats.totalLikes': liked ? 1 : -1 }
      });
      await recomputeUserScoreById(recording.user._id);
    }

    res.json({ liked, likes: recording.likes.length });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.commentRecording = async (req, res) => {
  try {
    const text = req.body?.text?.toString().trim();
    if (!text) {
      return res.status(400).json({ message: 'Comment text is required' });
    }

    const recording = await findRecordingById(req.params.id);

    if (!recording || !recording.shareToCommunity || !recording.isPublic) {
      return res.status(404).json({ message: 'Recording not found' });
    }

    recording.comments.push({
      user: req.user._id,
      text,
    });
    await recording.save();

    const populatedRecording = await AudioTrack.findById(recording._id)
      .populate('comments.user', 'username profile.avatar profile.city profile.neighborhood');

    res.json(populatedRecording?.comments || []);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.shareRecording = async (req, res) => {
  try {
    const recording = await findRecordingById(req.params.id);

    if (!recording || !recording.shareToCommunity || !recording.isPublic) {
      return res.status(404).json({ message: 'Recording not found' });
    }

    recording.shares += 1;
    await recording.save();

    if (recording.user?._id) {
      await AudioTrack.db.model('User').findByIdAndUpdate(recording.user._id, {
        $inc: { 'stats.totalShares': 1 }
      });
      await recomputeUserScoreById(recording.user._id);
      await grantGocoReward({
        userId: recording.user._id,
        actorId: req.user._id,
        actionType: 'content_share',
        targetType: 'audio',
        targetId: recording._id,
        metadata: { title: recording.title },
        eventKey: `audio_share:${recording._id}:${req.user._id}:${new Date().toISOString().slice(0, 10)}`,
      });
    }

    await createSharePost({
      authorId: req.user._id,
      targetType: 'audio',
      targetId: recording._id,
    });

    res.json({ shares: recording.shares });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.deleteRecording = async (req, res) => {
  try {
    const recording = await AudioTrack.findOne({
      _id: req.params.id,
      user: req.user._id,
      instrumental: false
    });

    if (!recording) {
      return res.status(404).json({ message: 'Recording not found' });
    }

    const likeCount = Array.isArray(recording.likes) ? recording.likes.length : 0;
    const plays = Number(recording.plays || 0);
    const shares = Number(recording.shares || 0);
    const audioPath = resolveStudioUploadPath(recording.audioUrl, 'audio');
    const rawVoicePath = resolveStudioUploadPath(recording.metadata?.rawVoiceUrl, 'audio');
    const coverPath = resolveStudioUploadPath(recording.coverImageUrl, 'covers');

    await recording.deleteOne();

    for (const filePath of [audioPath, rawVoicePath, coverPath]) {
      if (!filePath) {
        continue;
      }

      try {
        await safeRemoveStudioFile(filePath);
      } catch (cleanupError) {
        console.error(cleanupError);
      }
    }

    for (const remoteTarget of [
      { value: recording.audioUrl, subdirectory: 'audio' },
      { value: recording.metadata?.rawVoiceUrl, subdirectory: 'audio' },
      { value: recording.coverImageUrl, subdirectory: 'covers' },
    ]) {
      try {
        await deleteStoredFile(remoteTarget);
      } catch (cleanupError) {
        console.error(cleanupError);
      }
    }

    await AudioTrack.db.model('User').findByIdAndUpdate(recording.user, {
      $inc: {
        'stats.totalLikes': -likeCount,
        'stats.totalViews': -plays,
        'stats.totalShares': -shares,
      }
    });
    await recomputeUserScoreById(recording.user);

    res.json({ success: true, id: req.params.id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};