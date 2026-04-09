const jwt = require('jsonwebtoken');
const User = require('../models/user');

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
    
    socket.on('join-battle', ({ battleId, userId, username, role }) => {
      socket.join(battleId);
      
      if (!rooms.has(battleId)) {
        rooms.set(battleId, {
          participants: [],
          spectators: [],
          messages: []
        });
      }
      
      const room = rooms.get(battleId);
      const normalizedRole = normalizeRole(role);
      const safeUsername = username || 'GOMDE';

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

    socket.on('send-chat-message', ({ battleId, userId, username, role, message }) => {
      const trimmedMessage = typeof message === 'string' ? message.trim() : '';

      if (!battleId || !trimmedMessage) {
        return;
      }

      const room = rooms.get(battleId);

      if (!room) {
        return;
      }

      const chatMessage = buildChatMessage({
        userId: userId || socket.id,
        username,
        role,
        message: trimmedMessage
      });

      room.messages = [...room.messages.slice(-49), chatMessage];
      rooms.set(battleId, room);
      io.to(battleId).emit('chat-message', chatMessage);
    });
    
    // WebRTC signaling
    socket.on('offer', ({ battleId, offer, to }) => {
      socket.to(to).emit('offer', { offer, from: socket.id });
    });
    
    socket.on('answer', ({ battleId, answer, to }) => {
      socket.to(to).emit('answer', { answer, from: socket.id });
    });
    
    socket.on('ice-candidate', ({ battleId, candidate, to }) => {
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