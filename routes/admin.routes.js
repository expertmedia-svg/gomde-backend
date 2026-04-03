const express = require('express');
const router = express.Router();
const { protect, admin } = require('../middleware/auth');
const {
  getDashboardStats,
  getAllUsers,
  updateUserRole,
  toggleUserStatus,
  moderateVideo
} = require('../controllers/admin.controller');

router.use(protect, admin);

router.get('/dashboard', getDashboardStats);
router.get('/users', getAllUsers);
router.put('/users/:id/role', updateUserRole);
router.put('/users/:id/toggle', toggleUserStatus);
router.put('/videos/:id/moderate', moderateVideo);

module.exports = router;