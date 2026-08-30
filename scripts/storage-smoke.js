require('dotenv').config();

const fs = require('fs');
const {
  deleteStoredFile,
  uploadLocalFile,
} = require('../services/mediaStorage.service');

const localPath = '/tmp/gomde-s3-smoke.txt';

const run = async () => {
  const accessKeyId = String(process.env.MEDIA_S3_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = String(process.env.MEDIA_S3_SECRET_ACCESS_KEY || '').trim();

  console.log('Configuration:', {
    driver: process.env.MEDIA_STORAGE_DRIVER || '',
    bucket: process.env.MEDIA_S3_BUCKET || '',
    region: process.env.MEDIA_S3_REGION || '',
    cdn: process.env.MEDIA_CDN_URL || '',
    accessKeyPresent: Boolean(accessKeyId),
    accessKeyPrefix: accessKeyId.slice(0, 4),
    accessKeyLength: accessKeyId.length,
    secretPresent: Boolean(secretAccessKey),
    secretLength: secretAccessKey.length,
  });

  fs.writeFileSync(localPath, 'GOMDE S3 CloudFront OK');

  let uploaded;
  try {
    uploaded = await uploadLocalFile({
      localPath,
      subdirectory: 'smoke',
      fileName: `cdn-test-${Date.now()}.txt`,
      contentType: 'text/plain',
      cacheControl: 'no-cache',
    });

    console.log('URL CDN:', uploaded.publicUrl);
    const response = await fetch(uploaded.publicUrl);
    const content = await response.text();

    console.log('CloudFront HTTP:', response.status);
    console.log('Contenu:', content);

    if (!response.ok || content !== 'GOMDE S3 CloudFront OK') {
      throw new Error('La lecture CloudFront ne correspond pas au fichier envoyé.');
    }

    console.log('Test S3 + CloudFront : OK');
  } finally {
    if (uploaded?.publicUrl) {
      await deleteStoredFile({ value: uploaded.publicUrl });
      console.log('Objet de test supprimé de S3 : OK');
    }
    if (fs.existsSync(localPath)) {
      fs.unlinkSync(localPath);
    }
  }
};

run().catch((error) => {
  console.error('ECHEC:', error.name, error.message);
  process.exitCode = 1;
});
