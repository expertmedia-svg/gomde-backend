const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const normalizeOrigin = (value, fallback = '') => {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return fallback;
  }
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
};

const getRequestProtocol = (req) => {
  const forwardedProto = req?.get?.('x-forwarded-proto');
  if (forwardedProto) {
    return forwardedProto;
  }
  if (process.env.NODE_ENV === 'production') {
    return 'https';
  }
  return req?.protocol || 'https';
};

const getApplicationOrigin = (req) => {
  const explicitOrigin = normalizeOrigin(
    process.env.PUBLIC_ORIGIN,
    normalizeOrigin(process.env.MEDIA_PUBLIC_BASE_URL)
  );
  if (explicitOrigin) {
    return explicitOrigin;
  }

  const protocol = getRequestProtocol(req);
  const host = req?.get?.('host') || process.env.PUBLIC_HOST || 'localhost:5000';
  return `${protocol}://${host}`;
};

const getMediaOrigin = (req) => {
  const objectStorageOrigin = getObjectStorageOrigin();
  if (objectStorageOrigin) {
    return objectStorageOrigin;
  }

  const cdnOrigin = normalizeOrigin(process.env.MEDIA_CDN_URL);
  if (cdnOrigin) {
    return cdnOrigin;
  }
  return getApplicationOrigin(req);
};

const storageDriver = () => String(process.env.MEDIA_STORAGE_DRIVER || 'local').trim().toLowerCase();

const getS3Bucket = () => String(process.env.MEDIA_S3_BUCKET || '').trim();

const getS3Region = () => String(process.env.MEDIA_S3_REGION || 'auto').trim() || 'auto';

const getS3Prefix = () =>
  String(process.env.MEDIA_S3_PREFIX || '')
    .trim()
    .replace(/^\/+|\/+$/g, '');

const shouldUseS3PathStyle = () =>
  String(process.env.MEDIA_S3_FORCE_PATH_STYLE || '')
    .trim()
    .toLowerCase() === 'true';

const getS3Endpoint = () =>
  normalizeOrigin(
    process.env.MEDIA_S3_PUBLIC_ENDPOINT,
    normalizeOrigin(process.env.MEDIA_S3_ENDPOINT)
  );

const isObjectStorageEnabled = () => storageDriver() === 's3';

const getObjectStorageOrigin = () => {
  if (!isObjectStorageEnabled()) {
    return '';
  }

  const preferredPublicOrigin = normalizeOrigin(
    process.env.MEDIA_CDN_URL,
    normalizeOrigin(process.env.MEDIA_PUBLIC_BASE_URL)
  );
  if (preferredPublicOrigin) {
    return preferredPublicOrigin;
  }

  const bucket = getS3Bucket();
  const endpoint = getS3Endpoint();
  if (endpoint && bucket) {
    if (shouldUseS3PathStyle() || !endpoint.includes(`${bucket}.`)) {
      return `${endpoint}/${bucket}`;
    }
    return endpoint;
  }

  if (!bucket) {
    return '';
  }

  return `https://${bucket}.s3.${getS3Region()}.amazonaws.com`;
};

const toPublicMediaUrl = (req, value) => {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }

  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }

  const normalizedPath = raw.startsWith('/') ? raw : `/${raw}`;
  return `${getMediaOrigin(req)}${normalizedPath}`;
};

const buildUploadUrl = (req, subdirectory, filename) => {
  if (!filename) {
    return '';
  }
  return toPublicMediaUrl(req, `/uploads/${subdirectory}/${encodeURIComponent(filename)}`);
};

const buildObjectKey = (subdirectory, fileName) =>
  [getS3Prefix(), 'uploads', subdirectory, fileName]
    .filter(Boolean)
    .join('/');

const inferContentType = (fileName, fallback = 'application/octet-stream') => {
  const extension = path.extname(String(fileName || '')).toLowerCase();
  switch (extension) {
    case '.mp4':
      return 'video/mp4';
    case '.webm':
      return 'video/webm';
    case '.mov':
      return 'video/quicktime';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.mp3':
      return 'audio/mpeg';
    case '.m4a':
      return 'audio/mp4';
    case '.aac':
      return 'audio/aac';
    case '.wav':
      return 'audio/wav';
    case '.ogg':
      return 'audio/ogg';
    default:
      return fallback;
  }
};

const inferCacheControl = (subdirectory) => {
  if (subdirectory === 'thumbnails' || subdirectory === 'covers') {
    return 'public, max-age=604800, immutable';
  }
  return 'public, max-age=31536000, immutable';
};

const getS3Client = (() => {
  let client = null;

  return () => {
    if (client) {
      return client;
    }

    const config = {
      region: getS3Region(),
      forcePathStyle: shouldUseS3PathStyle(),
    };

    const endpoint = normalizeOrigin(process.env.MEDIA_S3_ENDPOINT);
    if (endpoint) {
      config.endpoint = endpoint;
    }

    const accessKeyId = String(process.env.MEDIA_S3_ACCESS_KEY_ID || '').trim();
    const secretAccessKey = String(process.env.MEDIA_S3_SECRET_ACCESS_KEY || '').trim();
    if (accessKeyId && secretAccessKey) {
      config.credentials = { accessKeyId, secretAccessKey };
    }

    client = new S3Client(config);
    return client;
  };
})();

const ensureObjectStorageConfig = () => {
  if (!isObjectStorageEnabled()) {
    return;
  }

  const missing = [];
  if (!getS3Bucket()) {
    missing.push('MEDIA_S3_BUCKET');
  }

  if (missing.length > 0) {
    throw new Error(`Object storage is enabled but missing config: ${missing.join(', ')}`);
  }
};

const uploadLocalFile = async ({ req, localPath, subdirectory, fileName, contentType, cacheControl }) => {
  if (!localPath || !fileName) {
    return {
      driver: storageDriver(),
      objectKey: '',
      publicUrl: '',
      relativePath: '',
      storedRemotely: false,
    };
  }

  const relativePath = `/uploads/${subdirectory}/${encodeURIComponent(fileName)}`;
  const objectKey = buildObjectKey(subdirectory, fileName);

  if (!isObjectStorageEnabled()) {
    return {
      driver: storageDriver(),
      objectKey,
      publicUrl: toPublicMediaUrl(req, relativePath),
      relativePath,
      storedRemotely: false,
    };
  }

  ensureObjectStorageConfig();

  await getS3Client().send(
    new PutObjectCommand({
      Bucket: getS3Bucket(),
      Key: objectKey,
      Body: fs.createReadStream(localPath),
      ContentType: contentType || inferContentType(fileName),
      CacheControl: cacheControl || inferCacheControl(subdirectory),
    })
  );

  return {
    driver: storageDriver(),
    objectKey,
    publicUrl: toPublicMediaUrl(req, relativePath),
    relativePath,
    storedRemotely: true,
  };
};

const extractRelativeUploadPath = (value) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return '';
  }

  let candidate = value.trim();
  if (/^https?:\/\//i.test(candidate)) {
    try {
      candidate = new URL(candidate).pathname;
    } catch (error) {
      return '';
    }
  }

  const uploadsIndex = candidate.indexOf('/uploads/');
  if (uploadsIndex === -1) {
    return '';
  }

  return decodeURIComponent(candidate.slice(uploadsIndex + 1));
};

const deleteStoredFile = async ({ value, subdirectory, fileName }) => {
  if (!isObjectStorageEnabled()) {
    return false;
  }

  const relativeUploadPath = extractRelativeUploadPath(value);
  const objectKey = relativeUploadPath || (fileName && subdirectory ? buildObjectKey(subdirectory, fileName) : '');

  if (!objectKey) {
    return false;
  }

  ensureObjectStorageConfig();

  await getS3Client().send(
    new DeleteObjectCommand({
      Bucket: getS3Bucket(),
      Key: relativeUploadPath ? [getS3Prefix(), relativeUploadPath].filter(Boolean).join('/') : objectKey,
    })
  );

  return true;
};

const storageSummary = (req) => ({
  driver: storageDriver(),
  mediaOrigin: getMediaOrigin(req),
  appOrigin: getApplicationOrigin(req),
  cdnEnabled: Boolean(normalizeOrigin(process.env.MEDIA_CDN_URL)),
  objectStorageEnabled: isObjectStorageEnabled(),
  bucket: getS3Bucket() || null,
  endpoint: getS3Endpoint() || null,
  prefix: getS3Prefix() || null,
});

const resolveLocalUploadPath = (subdirectory, fileName) =>
  path.join(__dirname, '..', 'uploads', subdirectory, fileName);

module.exports = {
  buildUploadUrl,
  deleteStoredFile,
  getApplicationOrigin,
  getMediaOrigin,
  getObjectStorageOrigin,
  getRequestProtocol,
  resolveLocalUploadPath,
  storageDriver,
  storageSummary,
  toPublicMediaUrl,
  uploadLocalFile,
};