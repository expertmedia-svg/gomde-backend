const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const Battle = require('../models/battle');
const { markBattleLive } = require('../services/battleLifecycle.service');

const createObjectId = () => new mongoose.Types.ObjectId();

test('battle model normalizes categories and computes winner', async () => {
  const firstUserId = createObjectId();
  const secondUserId = createObjectId();
  const battle = new Battle({
    title: 'Duel test',
    creator: firstUserId,
    challenger: secondUserId,
    categories: ['Reggae', 'one man show'],
    entries: [
      { user: firstUserId, videoUrl: '/uploads/videos/a.mp4' },
      { user: secondUserId, videoUrl: '/uploads/videos/b.mp4' },
    ],
    votes: [
      { user: createObjectId(), votedFor: secondUserId },
      { user: createObjectId(), votedFor: secondUserId },
      { user: createObjectId(), votedFor: firstUserId },
    ],
  });

  await battle.validate();
  battle.save = async function saveStub() {
    return this;
  };

  const finalized = await battle.calculateWinner();

  assert.deepEqual(finalized.categories, ['reggae', 'comedie']);
  assert.equal(finalized.primaryCategory, 'reggae');
  assert.equal(String(finalized.winner), String(secondUserId));
  assert.equal(finalized.status, 'completed');
  assert.equal(finalized.entries[1].score, 2);
});

test('markBattleLive opens live window with strict deadlines', () => {
  const now = new Date('2026-04-10T12:00:00.000Z');
  const battle = new Battle({
    title: 'Battle live',
    creator: createObjectId(),
    entries: [{ user: createObjectId(), videoUrl: '/uploads/videos/live.mp4' }],
  });

  markBattleLive(battle, now);

  assert.equal(battle.status, 'active');
  assert.equal(battle.lifecycle.inLiveFeed, true);
  assert.equal(battle.voteDeadline.toISOString(), '2026-04-16T12:00:00.000Z');
});

test('battle voting expiration returns zero when deadline is passed', () => {
  const battle = new Battle({
    title: 'Battle expiry',
    creator: createObjectId(),
    voteDeadline: new Date(Date.now() - 1000),
  });

  assert.equal(battle.isVotingExpired(), true);
});