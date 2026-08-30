const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  getNotifications,
  getUnreadCount,
  markRead,
  markAllRead,
  registerPushDevice,
  unregisterPushDevice,
} = require('../controllers/notification.controller');

router.post('/devices', protect, registerPushDevice);
router.delete('/devices', protect, unregisterPushDevice);
router.get('/', protect, getNotifications);
router.get('/unread-count', protect, getUnreadCount);
router.patch('/read-all', protect, markAllRead);
router.patch('/:id/read', protect, markRead);

module.exports = router;
