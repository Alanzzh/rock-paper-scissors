require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const crypto = require('crypto');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// Session 配置
app.use(session({
  secret: process.env.SESSION_SECRET || 'rock-paper-scissors-secret',
  resave: false,
  saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());
app.use(express.static('public'));

// Passport 序列化
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// Google OAuth 配置（仅在配置了凭据时启用）
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.CALLBACK_URL || 'http://localhost:3000/auth/google/callback'
  }, (accessToken, refreshToken, profile, done) => {
    return done(null, {
      id: profile.id,
      name: profile.displayName,
      email: profile.emails[0].value,
      avatar: profile.photos[0].value
    });
  }));
}

// OAuth 路由
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/' }),
  (req, res) => res.redirect('/')
);

app.get('/auth/user', (req, res) => {
  res.json(req.user || null);
});

app.get('/auth/logout', (req, res) => {
  req.logout(() => res.redirect('/'));
});

// 房间数据结构
const rooms = new Map();

class GameRoom {
  constructor(roomId) {
    this.roomId = roomId;
    this.players = new Map();
    this.state = 'WAITING'; // WAITING, READY, COMMIT, REVEAL, RESULT
    this.commitTimer = null;
    this.revealTimer = null;
  }

  addPlayer(socketId, playerName) {
    this.players.set(socketId, {
      id: socketId,
      name: playerName,
      ready: false,
      committed: false,
      hash: null,
      choice: null,
      salt: null,
      score: 0
    });
  }

  removePlayer(socketId) {
    this.players.delete(socketId);
  }

  setReady(socketId, ready) {
    const player = this.players.get(socketId);
    if (player) {
      player.ready = ready;
    }
  }

  allReady() {
    if (this.players.size < 2) return false;
    return Array.from(this.players.values()).every(p => p.ready);
  }

  allCommitted() {
    return Array.from(this.players.values()).every(p => p.committed || !p.ready);
  }

  allRevealed() {
    return Array.from(this.players.values()).every(p => p.choice !== null || !p.committed);
  }

  commitChoice(socketId, hash) {
    const player = this.players.get(socketId);
    if (player && this.state === 'COMMIT') {
      player.hash = hash;
      player.committed = true;
      return true;
    }
    return false;
  }

  revealChoice(socketId, choice, salt) {
    const player = this.players.get(socketId);
    if (!player || this.state !== 'REVEAL') return false;

    // 验证哈希
    const computed = crypto.createHash('sha256').update(choice + salt).digest('hex');
    if (computed !== player.hash) {
      return false;
    }

    player.choice = choice;
    player.salt = salt;
    return true;
  }

  calculateResults() {
    const activePlayers = Array.from(this.players.values()).filter(p => p.choice);

    if (activePlayers.length < 2) {
      return { type: 'NO_CONTEST', results: [] };
    }

    const results = activePlayers.map(p => ({
      id: p.id,
      name: p.name,
      choice: p.choice
    }));

    // 判断胜负
    const choices = activePlayers.map(p => p.choice);
    const uniqueChoices = [...new Set(choices)];

    if (uniqueChoices.length === 1 || uniqueChoices.length === 3) {
      // 平局
      return { type: 'DRAW', results };
    }

    // 判断获胜者
    const winMap = {
      'rock-scissors': 'rock',
      'scissors-paper': 'scissors',
      'paper-rock': 'paper'
    };

    const key1 = `${uniqueChoices[0]}-${uniqueChoices[1]}`;
    const key2 = `${uniqueChoices[1]}-${uniqueChoices[0]}`;
    const winningChoice = winMap[key1] || winMap[key2];

    activePlayers.forEach(p => {
      if (p.choice === winningChoice) {
        p.score++;
      }
    });

    return { type: 'WIN', results, winner: winningChoice };
  }

  reset() {
    this.state = 'WAITING';
    this.players.forEach(p => {
      p.ready = false;
      p.committed = false;
      p.hash = null;
      p.choice = null;
      p.salt = null;
    });
    if (this.commitTimer) clearTimeout(this.commitTimer);
    if (this.revealTimer) clearTimeout(this.revealTimer);
  }

  getPlayerList() {
    return Array.from(this.players.values()).map(p => ({
      id: p.id,
      name: p.name,
      ready: p.ready,
      committed: p.committed,
      score: p.score
    }));
  }
}

io.on('connection', (socket) => {
  console.log('玩家连接:', socket.id);

  socket.on('joinRoom', ({ roomId, playerName }) => {
    socket.join(roomId);

    if (!rooms.has(roomId)) {
      rooms.set(roomId, new GameRoom(roomId));
    }

    const room = rooms.get(roomId);
    room.addPlayer(socket.id, playerName);

    socket.emit('joined', {
      roomId,
      playerId: socket.id,
      players: room.getPlayerList()
    });

    io.to(roomId).emit('playerUpdate', room.getPlayerList());
  });

  socket.on('setReady', ({ roomId, ready }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    room.setReady(socket.id, ready);
    io.to(roomId).emit('playerUpdate', room.getPlayerList());

    if (room.allReady()) {
      room.state = 'COMMIT';
      io.to(roomId).emit('startCommit', { countdown: 5 });

      room.commitTimer = setTimeout(() => {
        startRevealPhase(room, roomId);
      }, 5000);
    }
  });

  socket.on('commit', ({ roomId, hash }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    if (room.commitChoice(socket.id, hash)) {
      io.to(roomId).emit('playerUpdate', room.getPlayerList());

      if (room.allCommitted()) {
        clearTimeout(room.commitTimer);
        startRevealPhase(room, roomId);
      }
    }
  });

  socket.on('reveal', ({ roomId, choice, salt }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    if (room.revealChoice(socket.id, choice, salt)) {
      if (room.allRevealed()) {
        clearTimeout(room.revealTimer);
        showResults(room, roomId);
      }
    }
  });

  socket.on('disconnect', () => {
    console.log('玩家断开:', socket.id);

    rooms.forEach((room, roomId) => {
      if (room.players.has(socket.id)) {
        room.removePlayer(socket.id);
        io.to(roomId).emit('playerUpdate', room.getPlayerList());

        if (room.players.size === 0) {
          rooms.delete(roomId);
        }
      }
    });
  });
});

function startRevealPhase(room, roomId) {
  room.state = 'REVEAL';
  io.to(roomId).emit('startReveal', { timeout: 2000 });

  room.revealTimer = setTimeout(() => {
    showResults(room, roomId);
  }, 2000);
}

function showResults(room, roomId) {
  const result = room.calculateResults();
  room.state = 'RESULT';

  io.to(roomId).emit('showResult', {
    ...result,
    players: room.getPlayerList()
  });

  setTimeout(() => {
    room.reset();
    io.to(roomId).emit('roundReset');
    io.to(roomId).emit('playerUpdate', room.getPlayerList());
  }, 5000);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`服务器运行在端口 ${PORT}`);
});
