const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildDisciplinePayload,
  normalizeDisciplineList,
} = require('../constants/disciplines');

test('normalizeDisciplineList maps required categories and aliases', () => {
  assert.deepEqual(
    normalizeDisciplineList(['Rap', 'dancehall', 'one man show', 'tradi moderne']),
    ['rap', 'dancehall', 'comedie', 'tradi-moderne']
  );
});

test('buildDisciplinePayload falls back safely for legacy content', () => {
  const payload = buildDisciplinePayload(null);

  assert.equal(payload.primaryCategory, 'rap');
  assert.deepEqual(payload.categories, ['rap']);
});