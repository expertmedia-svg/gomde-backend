const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const rateLimit = require('express-rate-limit');
const { register, login, getMe, updateProfile } = require('../controllers/auth.controller');
const { protect } = require('../middleware/auth');
const { uploadProfileMediaWithLogging } = require('../middleware/upload');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { message: 'Too many attempts, please try again later.' }
});

router.post('/register', authLimiter, [
  body('username').isLength({ min: 3 }).trim(),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('role').optional().isIn(['user', 'artist']),
  body('primaryDiscipline').optional().isString(),
  body('disciplines').optional().custom((value) => {
    if (typeof value === 'string' || Array.isArray(value)) {
      return true;
    }
    throw new Error('Invalid disciplines payload');
  })
], register);

router.post('/login', authLimiter, [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty()
], login);

router.get('/me', protect, getMe);
router.put('/profile', protect, uploadProfileMediaWithLogging, updateProfile);

module.exports = router;