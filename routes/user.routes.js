const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const User = require('../models/user');

router.get('/', protect, async (req, res) => {
  try {
    const { page = 1, limit = 20, role, city, search } = req.query;
    const query = { isActive: true };

    if (role) query.role = role;
    if (city) query['profile.city'] = city;
    if (search) {
      query.$or = [
        { username: { $regex: search, $options: 'i' } },
        { 'profile.city': { $regex: search, $options: 'i' } },
        { 'profile.neighborhood': { $regex: search, $options: 'i' } }
      ];
    }

    const users = await User.find(query)
      .select('-password')
      .sort({ 'stats.score': -1, createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await User.countDocuments(query);

    res.json({
      users,
      totalPages: Math.ceil(total / limit),
      currentPage: Number(page),
      total
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/:id', protect, async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('-password')
      .populate('stats.followers', 'username profile.avatar')
      .populate('stats.following', 'username profile.avatar');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    res.json(user);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/:id/follow', protect, async (req, res) => {
  try {
    const userToFollow = await User.findById(req.params.id);
    const currentUser = await User.findById(req.user._id);
    
    if (!userToFollow) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    if (userToFollow._id.toString() === currentUser._id.toString()) {
      return res.status(400).json({ message: 'Cannot follow yourself' });
    }
    
    const isFollowing = currentUser.stats.following.includes(userToFollow._id);
    
    if (isFollowing) {
      currentUser.stats.following = currentUser.stats.following.filter(
        id => id.toString() !== userToFollow._id.toString()
      );
      userToFollow.stats.followers = userToFollow.stats.followers.filter(
        id => id.toString() !== currentUser._id.toString()
      );
    } else {
      currentUser.stats.following.push(userToFollow._id);
      userToFollow.stats.followers.push(currentUser._id);
    }
    
    await currentUser.save();
    await userToFollow.save();
    
    res.json({ following: !isFollowing });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;