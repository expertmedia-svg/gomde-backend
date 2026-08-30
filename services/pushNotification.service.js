const PushDevice = require('../models/pushDevice');
const User = require('../models/user');

let firebaseMessaging;
let initializationAttempted = false;

const getMessaging = () => {
  if (initializationAttempted) return firebaseMessaging;
  initializationAttempted = true;

  try {
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId: process.env.FIREBASE_PROJECT_ID || undefined,
      });
    }
    firebaseMessaging = admin.messaging();
    console.log('[push] Firebase Cloud Messaging enabled');
  } catch (error) {
    firebaseMessaging = null;
    console.warn(`[push] Firebase disabled: ${error.message}`);
  }

  return firebaseMessaging;
};

const copyFor = (type, actorName) => {
  const who = actorName ? `@${actorName}` : 'Quelqu’un';
  const messages = {
    like: ['Nouveau j’aime', `${who} aime votre publication.`],
    comment: ['Nouveau commentaire', `${who} a commenté votre publication.`],
    follow: ['Nouvel abonné', `${who} vous suit maintenant.`],
    vote: ['Nouveau vote', `${who} a voté dans votre battle.`],
    challenge: ['Nouveau défi', `${who} vous lance un défi !`],
    battle_accepted: ['Défi accepté', `${who} a accepté votre défi.`],
    battle_refused: ['Défi refusé', `${who} a refusé votre défi.`],
  };
  return messages[type] || ['GOMDÉ', 'Vous avez une nouvelle interaction.'];
};

const sendPushNotification = async ({ recipient, actor, type, targetType, targetId, notificationId }) => {
  const messaging = getMessaging();
  if (!messaging) return { sent: 0, disabled: true };

  const devices = await PushDevice.find({ user: recipient }).select('+token').lean();
  if (!devices.length) return { sent: 0 };

  const actorUser = actor
    ? await User.findById(actor).select('username').lean()
    : null;
  const [title, body] = copyFor(type, actorUser?.username);
  const tokens = devices.map((device) => device.token);
  const response = await messaging.sendEachForMulticast({
    tokens,
    notification: { title, body },
    data: {
      type: String(type),
      targetType: String(targetType),
      targetId: String(targetId),
      notificationId: String(notificationId),
      route: targetType === 'battle' ? '/battles' : '/notifications',
    },
    android: {
      priority: 'high',
      notification: { channelId: 'gomde_interactions', sound: 'default' },
    },
    apns: { payload: { aps: { sound: 'default' } } },
  });

  const invalidCodes = new Set([
    'messaging/invalid-registration-token',
    'messaging/registration-token-not-registered',
  ]);
  const invalidTokens = response.responses
    .map((result, index) => (!result.success && invalidCodes.has(result.error?.code) ? tokens[index] : null))
    .filter(Boolean);
  if (invalidTokens.length) {
    await PushDevice.deleteMany({ token: { $in: invalidTokens } });
  }

  return { sent: response.successCount, failed: response.failureCount };
};

module.exports = { sendPushNotification };
