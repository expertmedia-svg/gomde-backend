const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/user');
const Battle = require('../models/battle');

module.exports = (io) => {
  const rooms = new Map();

  // Socket.IO JWT authentication middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) {
        return next(new Error('Authentication required'));
      }
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('username role isActive');
      if (!user || !user.isActive) {
        return next(new Error('User not found or disabled'));
      }
      socket.user = user;
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  const normalizeRole = (role) => role === 'participant' ? 'participant' : 'spectator';

  const buildChatMessage = ({ userId, username, role, message }) => ({
    id: `${Date.now()}-${Math.round(Math.random() * 1e6)}`,
    userId,
    username: username || 'GOMDE',
    role: normalizeRole(role),
    message,
    createdAt: new Date().toISOString()
  });

  const emitRoomState = (battleId, room) => {
    io.to(battleId).emit('room-state', {
      participants: room.participants,
      spectators: room.spectators.length
    });
  };
  
  io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);
    
    socket.on('join-battle', async ({ battleId, role }) => {
      if (!mongoose.isValidObjectId(battleId)) {
        socket.emit('error', 'Invalid battle id');
        return;
      }

      // Identity always comes from the authenticated socket, never from the
      // client payload — otherwise any authenticated socket could impersonate
      // another user or self-declare a "participant" role it doesn't hold.
      const userId = String(socket.user._id);
      const safeUsername = socket.user.username || 'GOMDE';
      let normalizedRole = normalizeRole(role);

      if (normalizedRole === 'participant') {
        const battle = await Battle.findById(battleId).select('entries.user');
        const isBattleParticipant = !!battle?.entries?.some(
          (entry) => entry.user && entry.user.toString() === userId
        );
        if (!isBattleParticipant) {
          normalizedRole = 'spectator';
        }
      }

      socket.join(battleId);
      socket.data.battleId = battleId;
      socket.data.role = normalizedRole;

      if (!rooms.has(battleId)) {
        rooms.set(battleId, {
          participants: [],
          spectators: [],
          messages: []
        });
      }

      const room = rooms.get(battleId);

      room.participants = room.participants.filter((participant) => participant.socketId !== socket.id);
      room.spectators = room.spectators.filter((spectator) => spectator.socketId !== socket.id);

      if (normalizedRole === 'participant') {
        if (room.participants.length < 2) {
          room.participants.push({ userId, socketId: socket.id, username: safeUsername, role: normalizedRole });
          socket.to(battleId).emit('participant-joined', { userId, username: safeUsername });
        } else {
          socket.emit('error', 'Battle room is full');
          return;
        }
      } else {
        room.spectators.push({ userId, socketId: socket.id, username: safeUsername, role: normalizedRole });
        socket.to(battleId).emit('spectator-joined', { userId, username: safeUsername });
      }

      rooms.set(battleId, room);

      emitRoomState(battleId, room);
      socket.emit('chat-history', room.messages);
    });

    socket.on('send-chat-message', ({ battleId, message }) => {
      const trimmedMessage = typeof message === 'string' ? message.trim() : '';

      if (!battleId || !trimmedMessage || socket.data.battleId !== battleId) {
        return;
      }

      const room = rooms.get(battleId);

      if (!room) {
        return;
      }

      const chatMessage = buildChatMessage({
        userId: String(socket.user._id),
        username: socket.user.username,
        role: socket.data.role,
        message: trimmedMessage
      });

      room.messages = [...room.messages.slice(-49), chatMessage];
      rooms.set(battleId, room);
      io.to(battleId).emit('chat-message', chatMessage);
    });

    // WebRTC signaling — only relay between two sockets that already joined
    // the same battle room, so an authenticated socket can't target an
    // arbitrary connected socket id outside its own battle.
    const sameBattleRoom = (to) => {
      const target = io.sockets.sockets.get(to);
      return !!target && !!socket.data.battleId && target.data.battleId === socket.data.battleId;
    };

    socket.on('offer', ({ offer, to }) => {
      if (!sameBattleRoom(to)) return;
      socket.to(to).emit('offer', { offer, from: socket.id });
    });

    socket.on('answer', ({ answer, to }) => {
      if (!sameBattleRoom(to)) return;
      socket.to(to).emit('answer', { answer, from: socket.id });
    });

    socket.on('ice-candidate', ({ candidate, to }) => {
      if (!sameBattleRoom(to)) return;
      socket.to(to).emit('ice-candidate', { candidate, from: socket.id });
    });
    
    socket.on('leave-battle', ({ battleId }) => {
      socket.leave(battleId);
      
      const room = rooms.get(battleId);
      if (room) {
        room.participants = room.participants.filter(p => p.socketId !== socket.id);
        room.spectators = room.spectators.filter(s => s.socketId !== socket.id);
        rooms.set(battleId, room);
        
        socket.to(battleId).emit('user-left', { userId: socket.id, socketId: socket.id });
        emitRoomState(battleId, room);
      }
    });
    
    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
      
      // Clean up rooms
      for (const [battleId, room] of rooms.entries()) {
        const wasParticipant = room.participants.some(p => p.socketId === socket.id);
        room.participants = room.participants.filter(p => p.socketId !== socket.id);
        room.spectators = room.spectators.filter(s => s.socketId !== socket.id);
        
        if (wasParticipant) {
          socket.to(battleId).emit('participant-left', { userId: socket.id, socketId: socket.id });
        } else {
          socket.to(battleId).emit('user-left', { userId: socket.id, socketId: socket.id });
        }
        
        if (room.participants.length === 0 && room.spectators.length === 0) {
          rooms.delete(battleId);
        } else {
          rooms.set(battleId, room);
          emitRoomState(battleId, room);
        }
      }
    });
  });
};