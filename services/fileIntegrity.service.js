const crypto = require('crypto');
const fs = require('fs');

const computeFileSha256 = (filePath) => new Promise((resolve, reject) => {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);

  stream.on('data', (chunk) => hash.update(chunk));
  stream.on('error', reject);
  stream.on('end', () => resolve(hash.digest('hex')));
});

const buildFileIntegrity = async (file) => {
  if (!file?.path) {
    return null;
  }

  const checksum = await computeFileSha256(file.path);
  return {
    checksum,
    sizeBytes: Number(file.size || 0),
    mimeType: file.mimetype || '',
    originalName: file.originalname || '',
    verifiedAt: new Date(),
  };
};

module.exports = {
  buildFileIntegrity,
  computeFileSha256,
};