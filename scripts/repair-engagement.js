require('dotenv').config();

const mongoose = require('mongoose');
const AudioTrack = require('../models/audioTrack');
const Battle = require('../models/battle');
const SocialPost = require('../models/socialPost');
const User = require('../models/user');
const Video = require('../models/video');
const { recomputeUserScoreById } = require('../services/score.service');

const dedupeLikes = async (Model) => {
  const cursor = Model.find({ 'likes.0': { $exists: true } }).select('likes').cursor();
  let repaired = 0;
  for await (const document of cursor) {
    const uniqueIds = [...new Set(document.likes.map((entry) => String(entry)))];
    if (uniqueIds.length !== document.likes.length) {
      document.likes = uniqueIds;
      await document.save();
      repaired += 1;
    }
  }
  return repaired;
};

const aggregateByOwner = async (Model, metrics) => {
  const project = { user: 1 };
  for (const [target, source] of Object.entries(metrics)) {
    project[target] = source === 'likes' ? { $size: { $ifNull: ['$likes', []] } } : { $ifNull: [`$${source}`, 0] };
  }
  return Model.aggregate([
    { $match: { user: { $ne: null } } },
    { $project: project },
    {
      $group: {
        _id: '$user',
        ...Object.fromEntries(Object.keys(metrics).map((key) => [key, { $sum: `$${key}` }])),
      },
    },
  ]);
};

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  const [videosRepaired, audioRepaired, battlesRepaired, postsRepaired] = await Promise.all([
    dedupeLikes(Video),
    dedupeLikes(AudioTrack),
    dedupeLikes(Battle),
    dedupeLikes(SocialPost),
  ]);

  const [videoStats, audioStats] = await Promise.all([
    aggregateByOwner(Video, { likes: 'likes', views: 'views', shares: 'shares' }),
    aggregateByOwner(AudioTrack, { likes: 'likes', views: 'plays', shares: 'shares' }),
  ]);

  const totals = new Map();
  for (const row of [...videoStats, ...audioStats]) {
    const key = String(row._id);
    const current = totals.get(key) || { likes: 0, views: 0, shares: 0 };
    current.likes += Number(row.likes || 0);
    current.views += Number(row.views || 0);
    current.shares += Number(row.shares || 0);
    totals.set(key, current);
  }

  const users = await User.find({}).select('_id');
  for (const user of users) {
    const total = totals.get(String(user._id)) || { likes: 0, views: 0, shares: 0 };
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          'stats.totalLikes': total.likes,
          'stats.totalViews': total.views,
          'stats.totalShares': total.shares,
        },
      }
    );
    await recomputeUserScoreById(user._id);
  }

  console.log({
    repairedDocuments: {
      videos: videosRepaired,
      audio: audioRepaired,
      battles: battlesRepaired,
      socialPosts: postsRepaired,
    },
    usersRecalculated: users.length,
    status: 'OK',
  });
};

run()
  .catch((error) => {
    console.error('ECHEC:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined);
  });
