const path = require('path');
const Video = require('../models/video');
const { buildFileIntegrity } = require('./fileIntegrity.service');
const {
  resolveLocalUploadPath,
  uploadLocalFile,
} = require('./mediaStorage.service');
const { createVideoThumbnail, transcodeFeedVideo, safeUnlink } = require('./videoTranscode.service');
const { syncPublicationPost } = require('./social.service');

const emitVideoProcessed = (io, userId, payload) => {
  if (!io) return;
  io.to(`user_${userId}`).emit('video-processed', payload);
};

/**
 * Runs the checksum/transcode/thumbnail/storage pipeline for a video that
 * was already accepted (status:'processing', 202 already sent to the
 * client). Called fire-and-forget from the upload request handler, with
 * `io`/`user` captured from the original request closure so no separate
 * require of server.js (and its circular-require risk) is needed.
 */
async function processUploadedVideo({ video, req, sourcePath, description, tags }) {
  const createdFiles = [];
  const io = req.app.get('io');
  const userId = req.user._id;
  const sourceFilename = path.basename(sourcePath);
  const sourceExtension = path.extname(sourceFilename).toLowerCase();

  try {
    const integrity = await buildFileIntegrity(req.file);
    let asset = null;
    let usedTranscodeFallback = false;

    try {
      const outputBasename = `${path.parse(req.file.filename).name}-mobile`;
      const transcoded = await transcodeFeedVideo({
        inputPath: sourcePath,
        outputBasename,
      });

      createdFiles.push(
        transcoded.outputPath,
        transcoded.lowOutputPath,
        transcoded.thumbnailPath,
        ...transcoded.hls.files.map((entry) => entry.filePath),
      );
      await safeUnlink(sourcePath);

      asset = {
        videoFilename: transcoded.outputFilename,
        lowVideoFilename: transcoded.lowOutputFilename,
        hls: transcoded.hls,
        thumbnailFilename: transcoded.thumbnailFilename,
      };
    } catch (transcodeError) {
      console.warn('Feed video transcode failed, evaluating fallback:', transcodeError.message);

      if (sourceExtension !== '.mp4') {
        await safeUnlink(sourcePath);
        await Video.findByIdAndUpdate(video._id, {
          status: 'failed',
          processingError: 'La vidéo n’a pas pu être convertie vers un format mobile compatible.',
        });
        emitVideoProcessed(io, userId, {
          videoId: video._id.toString(),
          status: 'failed',
          message: 'La vidéo n’a pas pu être convertie vers un format mobile compatible. Réessaie avec une nouvelle capture.',
        });
        return;
      }

      usedTranscodeFallback = true;
      let thumbnailFilename = null;

      try {
        thumbnailFilename = `${path.parse(sourceFilename).name}.jpg`;
        const thumbnailPath = path.join(
          path.dirname(path.dirname(sourcePath)),
          'thumbnails',
          thumbnailFilename
        );
        await createVideoThumbnail({ inputPath: sourcePath, thumbnailPath });
        createdFiles.push(thumbnailPath);
      } catch (thumbnailError) {
        console.warn('Feed thumbnail fallback failed:', thumbnailError.message);
        thumbnailFilename = null;
      }

      asset = {
        videoFilename: sourceFilename,
        lowVideoFilename: null,
        hls: null,
        thumbnailFilename,
      };
    }

    const storedVideo = await uploadLocalFile({
      req,
      localPath: resolveLocalUploadPath('videos', asset.videoFilename),
      subdirectory: 'videos',
      fileName: asset.videoFilename,
      contentType: 'video/mp4',
    });
    const storedThumbnail = asset.thumbnailFilename
      ? await uploadLocalFile({
          req,
          localPath: resolveLocalUploadPath('thumbnails', asset.thumbnailFilename),
          subdirectory: 'thumbnails',
          fileName: asset.thumbnailFilename,
          contentType: 'image/jpeg',
        })
      : null;
    const storedLowVideo = asset.lowVideoFilename
      ? await uploadLocalFile({
          req,
          localPath: resolveLocalUploadPath('videos', asset.lowVideoFilename),
          subdirectory: 'videos',
          fileName: asset.lowVideoFilename,
          contentType: 'video/mp4',
        })
      : null;
    let storedHlsMaster = null;
    if (asset.hls) {
      for (const hlsFile of asset.hls.files) {
        const stored = await uploadLocalFile({
          req,
          localPath: hlsFile.filePath,
          subdirectory: `videos/${asset.hls.relativeDirectory}`,
          fileName: hlsFile.fileName,
          contentType: hlsFile.fileName.endsWith('.m3u8')
            ? 'application/vnd.apple.mpegurl'
            : 'video/mp2t',
        });
        if (hlsFile.fileName === 'master.m3u8') storedHlsMaster = stored;
      }
    }

    const updatedVideo = await Video.findByIdAndUpdate(
      video._id,
      {
        videoUrl: storedVideo.publicUrl,
        renditions: {
          low: storedLowVideo?.publicUrl || storedVideo.publicUrl,
          standard: storedVideo.publicUrl,
        },
        hlsUrl: storedHlsMaster?.publicUrl || '',
        videoPublicId: storedVideo.objectKey || asset.videoFilename,
        uploadChecksum: integrity?.checksum || '',
        uploadSizeBytes: integrity?.sizeBytes || 0,
        uploadMimeType: integrity?.mimeType || '',
        thumbnailUrl: storedThumbnail?.publicUrl || '',
        status: 'ready',
      },
      { new: true }
    );

    if (usedTranscodeFallback) {
      console.warn(
        '[feed-video] fallback mp4 used',
        JSON.stringify({ userId: String(userId), sourceFilename, storedFilename: asset.videoFilename })
      );
    } else {
      console.info(
        '[feed-video] transcoded',
        JSON.stringify({ userId: String(userId), sourceFilename, storedFilename: asset.videoFilename })
      );
    }

    try {
      await syncPublicationPost({
        authorId: userId,
        targetType: 'video',
        targetId: video._id,
        text: description || video.title,
      });
    } catch (syncError) {
      // The video itself is already saved and publicly queryable at this point.
      // A failure to sync the social-feed post must not surface as a processing failure.
      console.error('[feed-video] syncPublicationPost failed', syncError);
    }

    emitVideoProcessed(io, userId, {
      videoId: video._id.toString(),
      status: 'ready',
      videoUrl: updatedVideo.videoUrl,
      thumbnailUrl: updatedVideo.thumbnailUrl,
      processingFallback: usedTranscodeFallback,
    });
  } catch (error) {
    console.error('[feed-video] background processing failed', error);

    if (req.file?.path) {
      try { await safeUnlink(req.file.path); } catch (cleanupError) { console.error(cleanupError); }
    }
    for (const filePath of createdFiles) {
      try { await safeUnlink(filePath); } catch (cleanupError) { console.error(cleanupError); }
    }

    await Video.findByIdAndUpdate(video._id, {
      status: 'failed',
      processingError: error.message || 'Server error',
    });
    emitVideoProcessed(io, userId, {
      videoId: video._id.toString(),
      status: 'failed',
      message: 'Une erreur est survenue pendant le traitement de la vidéo.',
    });
  }
}

module.exports = { processUploadedVideo };
