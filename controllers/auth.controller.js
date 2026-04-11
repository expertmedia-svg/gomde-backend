const User = require('../models/user');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const path = require('path');
const { validationResult } = require('express-validator');
const { buildDisciplinePayload } = require('../constants/disciplines');
const { normalizeBurkinaProfile } = require('../services/location.service');
const { deleteStoredFile, toPublicMediaUrl } = require('../services/mediaStorage.service');

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
  favoriteCount: Array.isArray(user.savedContent) ? user.savedContent.length : 0,
  wallet: user.wallet,
  verified: user.verified,
  primaryDiscipline: user.primaryDiscipline,
  disciplines: user.disciplines,
});

const parseProfilePayload = (rawProfile) => {
  if (!rawProfile) {
    return null;
  }

  if (typeof rawProfile === 'string') {
    try {
      return JSON.parse(rawProfile);
    } catch (error) {
      return null;
    }
  }

  if (typeof rawProfile === 'object') {
    return rawProfile;
  }

  return null;
};

const resolveLocalCoverPath = (value) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return '';
  }

  let candidate = value.trim();
  if (/^https?:\/\//i.test(candidate)) {
    try {
      candidate = new URL(candidate).pathname;
    } catch (error) {
      return '';
    }
  }

  if (!candidate.startsWith('/uploads/covers/')) {
    return '';
  }

  const resolvedPath = path.join(__dirname, '..', decodeURIComponent(candidate.slice(1)));
  const coversRoot = path.join(__dirname, '..', 'uploads', 'covers');

  if (!resolvedPath.startsWith(coversRoot)) {
    return '';
  }

  return resolvedPath;
};

const cleanupReplacedProfileMedia = async (previousValue, nextValue) => {
  if (!previousValue || previousValue === nextValue || String(previousValue).startsWith('/public/')) {
    return;
  }

  try {
    await deleteStoredFile({ value: previousValue });
  } catch (error) {
    console.error('Failed to delete remote profile media:', error.message);
  }

  try {
    const localPath = resolveLocalCoverPath(previousValue);
    if (localPath && fs.existsSync(localPath)) {
      fs.unlinkSync(localPath);
    }
  } catch (error) {
    console.error('Failed to delete local profile media:', error.message);
  }
};

const normalizeMediaLayout = (rawLayout = {}, currentLayout = {}) => {
  const normalizeSlot = (rawSlot = {}, currentSlot = {}) => ({
    positionX: Number.isFinite(Number(rawSlot?.positionX))
      ? Number(rawSlot.positionX)
      : Number.isFinite(Number(currentSlot?.positionX))
        ? Number(currentSlot.positionX)
        : 50,
    positionY: Number.isFinite(Number(rawSlot?.positionY))
      ? Number(rawSlot.positionY)
      : Number.isFinite(Number(currentSlot?.positionY))
        ? Number(currentSlot.positionY)
        : 50,
    scale: Number.isFinite(Number(rawSlot?.scale))
      ? Number(rawSlot.scale)
      : Number.isFinite(Number(currentSlot?.scale))
        ? Number(currentSlot.scale)
        : 1,
  });

  return {
    avatar: normalizeSlot(rawLayout?.avatar, currentLayout?.avatar),
    cover: normalizeSlot(rawLayout?.cover, currentLayout?.cover),
  };
};

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
    const parsedProfile = parseProfilePayload(req.body.profile);
    const avatarFile = req.files?.avatar?.[0] || null;
    const coverFile = req.files?.cover?.[0] || null;
    
    Object.keys(req.body).forEach(key => {
      if (allowedUpdates.includes(key)) {
        updates[key] = req.body[key];
      }
    });

    if (parsedProfile) {
      updates.profile = parsedProfile;
    }

    let currentUser = null;
    if (updates.profile || avatarFile || coverFile) {
      currentUser = await User.findById(req.user._id).select('profile');
      if (!currentUser) {
        return res.status(404).json({ message: 'User not found' });
      }

      const currentProfile = currentUser.profile || {};
      const requestedProfile = updates.profile || {};
      const nextAvatar = avatarFile
        ? toPublicMediaUrl(req, `/uploads/covers/${encodeURIComponent(avatarFile.filename)}`)
        : requestedProfile.avatar ?? currentProfile.avatar;
      const nextCoverImage = coverFile
        ? toPublicMediaUrl(req, `/uploads/covers/${encodeURIComponent(coverFile.filename)}`)
        : requestedProfile.coverImage ?? currentProfile.coverImage;
      const nextMediaLayout = normalizeMediaLayout(
        requestedProfile.mediaLayout,
        currentProfile.mediaLayout
      );

      updates.profile = {
        ...currentProfile,
        ...requestedProfile,
        ...normalizeBurkinaProfile({
          city: requestedProfile.city,
          neighborhood: requestedProfile.neighborhood,
          region: requestedProfile.region,
          currentProfile,
        }),
        bio: requestedProfile.bio ?? currentProfile.bio,
        fullName: requestedProfile.fullName ?? currentProfile.fullName,
        avatar: nextAvatar,
        coverImage: nextCoverImage,
        mediaLayout: nextMediaLayout,
        socialLinks: requestedProfile.socialLinks
          ? {
              ...(currentProfile.socialLinks || {}),
              ...requestedProfile.socialLinks,
            }
          : currentProfile.socialLinks,
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

    if (currentUser && updates.profile) {
      await Promise.all([
        cleanupReplacedProfileMedia(currentUser.profile?.avatar, updates.profile.avatar),
        cleanupReplacedProfileMedia(currentUser.profile?.coverImage, updates.profile.coverImage),
      ]);
    }
    
    res.json(user);
  } catch (error) {
    if (error?.message?.includes('Ville') || error?.message?.includes('Région') || error?.message?.includes('quartier')) {
      return res.status(400).json({ message: error.message });
    }
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};