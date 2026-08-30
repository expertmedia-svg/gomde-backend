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
  body('email').optional({ checkFalsy: true }).isEmail().normalizeEmail(),
  body('password').optional({ checkFalsy: true }).isLength({ min: 6 }),
  body('phone').optional({ checkFalsy: true }).custom((value) => {
    const digits = String(value).replace(/\D/g, '');
    const local = digits.startsWith('226') ? digits.slice(3) : digits;
    if (/^\d{8}$/.test(local)) return true;
    throw new Error('Invalid Burkina Faso phone number');
  }),
  body('pin').optional({ checkFalsy: true }).matches(/^\d{4}$/),
  body().custom((value) => {
    const hasPhonePin = Boolean(value.phone && value.pin);
    const hasEmailPassword = Boolean(value.email && value.password);
    if (hasPhonePin || hasEmailPassword) return true;
    throw new Error('Phone/PIN or email/password is required');
  }),
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
  body('email').optional({ checkFalsy: true }).isEmail().normalizeEmail(),
  body('password').optional({ checkFalsy: true }).notEmpty(),
  body('phone').optional({ checkFalsy: true }).custom((value) => {
    const digits = String(value).replace(/\D/g, '');
    const local = digits.startsWith('226') ? digits.slice(3) : digits;
    if (/^\d{8}$/.test(local)) return true;
    throw new Error('Invalid Burkina Faso phone number');
  }),
  body('pin').optional({ checkFalsy: true }).matches(/^\d{4}$/),
  body().custom((value) => {
    if ((value.phone && value.pin) || (value.email && value.password)) return true;
    throw new Error('Phone/PIN or email/password is required');
  }),
], login);

router.get('/me', protect, getMe);
router.put('/profile', protect, uploadProfileMediaWithLogging, updateProfile);

module.exports = router;
