const Notification = require('../models/notification');

exports.getNotifications = async (req, res) => {
  try {
    const { page = 1, limit = 30 } = req.query;
    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(50, Math.max(1, Number(limit) || 30));

    const query = { recipient: req.user._id };

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(query)
        .populate('actor', 'username profile.avatar')
        .sort({ createdAt: -1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit),
      Notification.countDocuments(query),
      Notification.countDocuments({ recipient: req.user._id, read: false }),
    ]);

    res.json({
      notifications,
      total,
      unreadCount,
      currentPage: safePage,
      totalPages: Math.max(1, Math.ceil(total / safeLimit)),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.getUnreadCount = async (req, res) => {
  try {
    const unreadCount = await Notification.countDocuments({
      recipient: req.user._id,
      read: false,
    });
    res.json({ unreadCount });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.markRead = async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, recipient: req.user._id },
      { read: true },
      { new: true }
    );
    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }
    res.json(notification);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.markAllRead = async (req, res) => {
  try {
    await Notification.updateMany(
      { recipient: req.user._id, read: false },
      { read: true }
    );
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};
