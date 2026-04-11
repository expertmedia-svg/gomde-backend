const User = require('../models/user');
const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const { buildDisciplinePayload } = require('../constants/disciplines');
const { normalizeBurkinaProfile } = require('../services/location.service');

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '7d'
  });
};

const serializeUser = (user) => ({
  id: user._id,
  username: user.username,
  email: user.email,
  role: user.role,
  profile: user.profile,
  stats: user.stats,
  wallet: user.wallet,
  verified: user.verified,
  primaryDiscipline: user.primaryDiscipline,
  disciplines: user.disciplines,
});

exports.register = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      username,
      email,
      password,
      role,
      city,
      neighborhood,
      region,
      primaryDiscipline,
      disciplines,
    } = req.body;
    const normalizedRole = (role === 'artist') ? 'artist' : 'user';
    const disciplinePayload = buildDisciplinePayload(
      Array.isArray(disciplines) && disciplines.length > 0
        ? disciplines
        : primaryDiscipline
    );

    const userExists = await User.findOne({ $or: [{ email }, { username }] });
    if (userExists) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const profile = normalizeBurkinaProfile({ city, neighborhood, region });

    const user = await User.create({
      username,
      email,
      password,
      role: normalizedRole,
      profile,
      primaryDiscipline: disciplinePayload.primaryCategory,
      disciplines: disciplinePayload.categories,
    });

    const token = generateToken(user._id);

    res.status(201).json({
      success: true,
      token,
      user: serializeUser(user)
    });
  } catch (error) {
    if (error?.message?.includes('Ville') || error?.message?.includes('Région') || error?.message?.includes('quartier')) {
      return res.status(400).json({ message: error.message });
    }
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email }).select('+password');
    
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    if (!user.isActive) {
      return res.status(401).json({ message: 'Account is disabled' });
    }

    user.lastLogin = Date.now();
    await user.save();

    const token = generateToken(user._id);

    res.json({
      success: true,
      token,
      user: serializeUser(user)
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select('-password')
      .populate('stats.followers', 'username profile.avatar')
      .populate('stats.following', 'username profile.avatar');
    
    res.json(user);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const allowedUpdates = ['profile', 'username', 'primaryDiscipline', 'disciplines'];
    const updates = {};
    
    Object.keys(req.body).forEach(key => {
      if (allowedUpdates.includes(key)) {
        updates[key] = req.body[key];
      }
    });

    if (updates.profile) {
      const currentUser = await User.findById(req.user._id).select('profile');
      if (!currentUser) {
        return res.status(404).json({ message: 'User not found' });
      }

      updates.profile = {
        ...currentUser.profile,
        ...normalizeBurkinaProfile({
          city: updates.profile.city,
          neighborhood: updates.profile.neighborhood,
          region: updates.profile.region,
          currentProfile: currentUser.profile,
        }),
        bio: updates.profile.bio ?? currentUser.profile?.bio,
        fullName: updates.profile.fullName ?? currentUser.profile?.fullName,
        avatar: updates.profile.avatar ?? currentUser.profile?.avatar,
        socialLinks: updates.profile.socialLinks ?? currentUser.profile?.socialLinks,
      };
    }

    if (updates.primaryDiscipline !== undefined || updates.disciplines !== undefined) {
      const disciplinePayload = buildDisciplinePayload(
        Array.isArray(updates.disciplines) && updates.disciplines.length > 0
          ? updates.disciplines
          : updates.primaryDiscipline
      );
      updates.primaryDiscipline = disciplinePayload.primaryCategory;
      updates.disciplines = disciplinePayload.categories;
    }
    
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: updates, updatedAt: Date.now() },
      { new: true, runValidators: true }
    ).select('-password');
    
    res.json(user);
  } catch (error) {
    if (error?.message?.includes('Ville') || error?.message?.includes('Région') || error?.message?.includes('quartier')) {
      return res.status(400).json({ message: error.message });
    }
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};