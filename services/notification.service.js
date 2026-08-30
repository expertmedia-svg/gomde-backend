const Notification = require('../models/notification');
const { sendPushNotification } = require('./pushNotification.service');

/**
 * Creates a notification as a side effect of some other action (a like, a
 * comment, a follow, a vote, a challenge). Deliberately fire-and-forget:
 * callers `await` it for ordering but a failure here must never surface as
 * a failure of the primary action (the like/comment/follow/vote itself
 * already succeeded by the time this runs) — matches the same pattern
 * already used for syncPublicationPost in video/studio controllers.
 */
const notify = async ({ recipient, actor = null, type, targetType, targetId }) => {
  try {
    if (!recipient || !type || !targetType || !targetId) {
      return null;
    }
    // Never notify a user about their own action.
    if (actor && String(actor) === String(recipient)) {
      return null;
    }

    const notification = await Notification.create({
      recipient,
      actor,
      type,
      targetType,
      targetId,
    });
    sendPushNotification({
      recipient,
      actor,
      type,
      targetType,
      targetId,
      notificationId: notification._id,
    }).catch((error) => console.error('[push] send failed', error.message));
    return notification;
  } catch (error) {
    console.error('[notification.service] failed to create notification', error);
    return null;
  }
};

module.exports = { notify };
