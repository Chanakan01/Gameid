const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET','POST'] }
});

const QUESTIONS_PATH = path.join(__dirname, 'data', 'questions.json');
let questions = [];
try {
  questions = JSON.parse(fs.readFileSync(QUESTIONS_PATH, 'utf8'));
} catch (e) {
  console.error('Cannot load questions.json', e);
  questions = [];
}

const rooms = new Map();

const POWERS = {
  PLUS: 'PLUS',
  MINUS: 'MINUS',
  SWAP_LOW: 'SWAP_LOW',
  SWAP_HIGH: 'SWAP_HIGH',
  X2_SCORE: 'X2_SCORE',
  STUN: 'STUN',
  FINAL_X4: 'FINAL_X4'
};

function randomRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function createRoom() {
  let code;
  do { code = randomRoomCode(); } while (rooms.has(code));
  const room = {
    code,
    hostSocketId: null,
    state: 'lobby',
    currentQuestionIndex: 0,
    questionEndsAt: null,
    players: [],
    timer: null
  };
  rooms.set(code, room);
  return room;
}

function getQuestion(index) {
  const q = questions[index];
  if (!q) return null;
  const isLast = index === questions.length - 1;
  return { ...q, isLast };
}

function getEffectiveScore(q, answerIndex) {
  if (!q || !Array.isArray(q.optionScores)) return 0;
  const base = q.optionScores[answerIndex] || 0;
  return q.isLast ? base * 4 : base;
}

function randomPower(questionIndex) {
  const isLast = questionIndex === questions.length - 1;
  const pool = [
    POWERS.PLUS,
    POWERS.MINUS,
    POWERS.SWAP_LOW,
    POWERS.SWAP_HIGH,
    POWERS.X2_SCORE,
    POWERS.STUN
  ];
  if (isLast) pool.push(POWERS.FINAL_X4);
  return pool[Math.floor(Math.random() * pool.length)];
}

function sanitizeRoom(room) {
  return {
    code: room.code,
    state: room.state,
    currentQuestionIndex: room.currentQuestionIndex,
    players: room.players.map(p => ({
      playerId: p.playerId,
      name: p.name,
      avatarId: p.avatarId,
      score: p.score,
      stunnedUntil: p.stunnedUntil
    }))
  };
}

function broadcastRoom(room) {
  io.to(room.code).emit('room:update', sanitizeRoom(room));
}

function startQuestion(room) {
  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }
  const qIndex = room.currentQuestionIndex;
  const q = getQuestion(qIndex);
  if (!q) {
    endGame(room);
    return;
  }
  room.state = 'question';
  const durationMs = 30000;
  const endsAt = Date.now() + durationMs;
  room.questionEndsAt = endsAt;
  io.to(room.code).emit('room:question:start', {
    questionIndex: qIndex,
    question: {
      id: q.id,
      text: q.text,
      options: q.options,
      optionScores: q.optionScores,
      bestIndex: q.bestIndex,
      isLast: q.isLast
    },
    endsAt
  });
  room.timer = setTimeout(() => finalizeQuestion(room), durationMs + 1000);
}

function finalizeQuestion(room) {
  room.timer = null;
  const qIndex = room.currentQuestionIndex;
  const q = getQuestion(qIndex);
  if (!q) return;

  room.players.forEach(p => {
    const ans = p.answers.find(a => a.questionIndex === qIndex);
    if (!ans) return;
    if (ans.answerIndex === q.bestIndex) {
      const type = randomPower(qIndex);
      p.powers.push({ type, used: false });
    }
  });

  room.state = 'results';
  const leaderboard = [...room.players]
    .sort((a, b) => b.score - a.score)
    .map((p, idx) => ({
      rank: idx + 1,
      playerId: p.playerId,
      name: p.name,
      score: p.score
    }));
  const playersPowers = room.players.map(p => ({
    playerId: p.playerId,
    powers: p.powers
  }));
  io.to(room.code).emit('room:question:results', {
    questionIndex: qIndex,
    bestIndex: q.bestIndex,
    leaderboard,
    playersPowers
  });

  setTimeout(() => {
    room.currentQuestionIndex += 1;
    if (room.currentQuestionIndex >= questions.length) {
      endGame(room);
    } else {
      startQuestion(room);
      broadcastRoom(room);
    }
  }, 4000);
}

function endGame(room) {
  room.state = 'ended';
  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }
  const leaderboard = [...room.players]
    .sort((a,b) => b.score - a.score)
    .map((p, idx) => ({
      rank: idx+1,
      playerId: p.playerId,
      name: p.name,
      score: p.score
    }));
  io.to(room.code).emit('room:game:ended', { leaderboard });
}

function applyPower(room, type, actor, target) {
  const players = room.players;
  switch (type) {
    case POWERS.PLUS: {
      const delta = 1000 + Math.floor(Math.random()*6000);
      actor.score += delta;
      break;
    }
    case POWERS.MINUS: {
      const delta = 1000 + Math.floor(Math.random()*6000);
      target.score = Math.max(0, target.score - delta);
      break;
    }
    case POWERS.SWAP_LOW: {
      if (!players.length) break;
      const lowest = [...players].sort((a,b)=>a.score-b.score)[0];
      if (!lowest) break;
      const tmp = actor.score;
      actor.score = lowest.score;
      lowest.score = tmp;
      break;
    }
    case POWERS.SWAP_HIGH: {
      if (!players.length) break;
      const highest = [...players].sort((a,b)=>b.score-a.score)[0];
      if (!highest) break;
      const tmp = actor.score;
      actor.score = highest.score;
      highest.score = tmp;
      break;
    }
    case POWERS.X2_SCORE: {
      actor.score *= 2;
      break;
    }
    case POWERS.STUN: {
      const qIndex = room.currentQuestionIndex;
      target.stunnedUntil = qIndex + 1;
      break;
    }
    case POWERS.FINAL_X4: {
      const qIndex = room.currentQuestionIndex;
      const q = getQuestion(qIndex);
      if (!q || !q.isLast) break;
      actor.score *= 4;
      break;
    }
    default:
      break;
  }
}

io.on('connection', (socket) => {
  console.log('client connected', socket.id);

  socket.on('host:createRoom', (cb) => {
    const room = createRoom();
    room.hostSocketId = socket.id;
    socket.join(room.code);
    cb && cb({ roomCode: room.code });
    broadcastRoom(room);
  });

  socket.on('room:join', (payload, cb) => {
    const { roomCode, name, avatarId, playerId } = payload || {};
    const code = (roomCode || '').toUpperCase();
    const room = rooms.get(code);
    if (!room) {
      cb && cb({ error: 'Room not found' });
      return;
    }
    let player = room.players.find(p => p.playerId === playerId);
    if (player) {
      player.socketId = socket.id;
    } else {
      if (room.players.some(p => p.avatarId === avatarId)) {
        cb && cb({ error: 'Avatar already taken' });
        return;
      }
      player = {
        playerId,
        socketId: socket.id,
        name,
        avatarId,
        score: 0,
        stunnedUntil: -1,
        answers: [],
        powers: []
      };
      room.players.push(player);
    }
    socket.join(room.code);
    broadcastRoom(room);
    cb && cb({ ok: true, roomCode: room.code, playerId: player.playerId });
  });

  socket.on('host:startGame', (payload) => {
    const { roomCode } = payload || {};
    const room = rooms.get(roomCode);
    if (!room) return;
    room.currentQuestionIndex = 0;
    room.players.forEach(p => {
      p.score = 0;
      p.stunnedUntil = -1;
      p.answers = [];
      p.powers = [];
    });
    startQuestion(room);
    broadcastRoom(room);
  });

  socket.on('player:submitAnswer', (payload, cb) => {
    const { roomCode, playerId, answerIndex } = payload || {};
    const room = rooms.get(roomCode);
    if (!room) { cb && cb({ error: 'Room not found' }); return; }
    const now = Date.now();
    if (!room.questionEndsAt || now > room.questionEndsAt) {
      cb && cb({ error: 'Time is up' }); return;
    }
    const player = room.players.find(p => p.playerId === playerId);
    if (!player) { cb && cb({ error: 'Player not found' }); return; }
    const qIndex = room.currentQuestionIndex;
    if (player.stunnedUntil > qIndex) {
      cb && cb({ error: 'You are stunned this question' }); return;
    }
    if (player.answers.some(a => a.questionIndex === qIndex)) {
      cb && cb({ error: 'Already answered' }); return;
    }
    const q = getQuestion(qIndex);
    if (!q) { cb && cb({ error: 'No question' }); return; }
    const gained = getEffectiveScore(q, answerIndex);
    player.answers.push({ questionIndex: qIndex, answerIndex, gained });
    player.score += gained;
    broadcastRoom(room);
    cb && cb({ ok: true, gained });
  });

  socket.on('player:usePower', (payload, cb) => {
    const { roomCode, playerId, targetPlayerId, powerIndex } = payload || {};
    const room = rooms.get(roomCode);
    if (!room) { cb && cb({ error: 'Room not found' }); return; }
    const actor = room.players.find(p => p.playerId === playerId);
    const target = room.players.find(p => p.playerId === targetPlayerId) || actor;
    if (!actor) { cb && cb({ error: 'Actor not found' }); return; }
    const power = actor.powers[powerIndex];
    if (!power || power.used) { cb && cb({ error: 'Power not available' }); return; }
    applyPower(room, power.type, actor, target);
    power.used = true;
    const payloadOut = {
      powerType: power.type,
      actor: { playerId: actor.playerId, name: actor.name },
      target: { playerId: target.playerId, name: target.name },
      players: room.players.map(p => ({
        playerId: p.playerId,
        name: p.name,
        score: p.score,
        stunnedUntil: p.stunnedUntil
      }))
    };
    io.to(room.code).emit('room:power:used', payloadOut);
    broadcastRoom(room);
    cb && cb({ ok: true });
  });

  socket.on('disconnect', () => {
    console.log('client disconnected', socket.id);
  });
});

app.get('/', (req,res) => {
  res.json({ status: 'ok', rooms: rooms.size, questions: questions.length });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log('Server listening on port', PORT);
});
