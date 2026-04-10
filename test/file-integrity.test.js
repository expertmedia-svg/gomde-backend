const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { computeFileSha256 } = require('../services/fileIntegrity.service');

test('computeFileSha256 returns deterministic checksum', async () => {
  const tempFile = path.join(os.tmpdir(), `gomde-integrity-${Date.now()}.txt`);
  await fs.writeFile(tempFile, 'gomde-test-payload', 'utf8');

  const checksum = await computeFileSha256(tempFile);

  assert.equal(checksum, 'bc45428a70902d7322c106f9c2d8c640c3f51aef57f8984f83839e1c427278ef');
  await fs.unlink(tempFile);
});