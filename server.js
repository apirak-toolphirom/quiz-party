'use strict';
/**
 * Quiz Party — เกมตอบคำถามสไตล์ Kahoot
 * Express + Socket.IO (เรียลไทม์), เก็บแบบทดสอบเป็นไฟล์ JSON, ไฟล์ภาพ/เสียงใน data/uploads
 */
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Server } = require('socket.io');
const multer = require('multer');
const QRCode = require('qrcode');

const PORT = process.env.PORT || 3000;
// บน GitHub Codespaces จะสร้างลิงก์สาธารณะให้อัตโนมัติ
const CODESPACE_URL = process.env.CODESPACE_NAME && process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN
  ? `https://${process.env.CODESPACE_NAME}-${process.env.PORT || 3000}.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}` : '';
const PUBLIC_URL = (process.env.PUBLIC_URL || CODESPACE_URL).replace(/\/$/, '');
const HOST_KEY = process.env.HOST_KEY || '';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const QUIZ_DIR = path.join(DATA_DIR, 'quizzes');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const MAX_PLAYERS = parseInt(process.env.MAX_PLAYERS) || 300;
[QUIZ_DIR, UPLOAD_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

// คัดลอกแบบทดสอบตัวอย่างครั้งแรก
const SAMPLE_DIR = path.join(__dirname, 'samples');
if (fs.existsSync(SAMPLE_DIR) && fs.readdirSync(QUIZ_DIR).length === 0) {
  for (const f of fs.readdirSync(SAMPLE_DIR)) {
    if (f.endsWith('.json')) fs.copyFileSync(path.join(SAMPLE_DIR, f), path.join(QUIZ_DIR, f));
  }
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e6 });

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));

/* ---------------- ผู้จัด (host key) ---------------- */
const checkKey = k => !HOST_KEY || k === HOST_KEY;
function requireHost(req, res, next) {
  if (checkKey(req.get('x-host-key'))) return next();
  res.status(401).json({ error: 'ต้องใส่รหัสผู้จัด (HOST_KEY)' });
}

/* ---------------- แบบทดสอบ ---------------- */
const validId = id => typeof id === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(id);
const quizPath = id => path.join(QUIZ_DIR, id + '.json');
function readQuiz(id) {
  if (!validId(id)) return null;
  try { return JSON.parse(fs.readFileSync(quizPath(id), 'utf8')); } catch { return null; }
}
const okUrl = u => (typeof u === 'string' && (u.startsWith('/uploads/') || /^https?:\/\//i.test(u))) ? u.slice(0, 500) : '';

function sanitizeQuiz(q) {
  const out = {
    id: q.id,
    title: String(q.title || 'แบบทดสอบใหม่').slice(0, 120),
    description: String(q.description || '').slice(0, 500),
    questions: []
  };
  for (const it of (Array.isArray(q.questions) ? q.questions : []).slice(0, 200)) {
    const options = (Array.isArray(it.options) ? it.options : []).slice(0, 4).map(o => String(o ?? '').slice(0, 120));
    while (options.length < 2) options.push('');
    let correct = parseInt(it.correct);
    if (!(correct >= 0 && correct < options.length)) correct = 0;
    out.questions.push({
      text: String(it.text || '').slice(0, 300),
      image: okUrl(it.image),
      audio: okUrl(it.audio),
      options,
      correct,
      time: Math.min(120, Math.max(5, parseInt(it.time) || 20)),
      double: !!it.double
    });
  }
  return out;
}

app.get('/api/config', (req, res) => res.json({ publicUrl: PUBLIC_URL, needKey: !!HOST_KEY }));
app.get('/api/check-key', (req, res) => res.json({ ok: checkKey(req.get('x-host-key')) }));

app.get('/api/quizzes', requireHost, (req, res) => {
  const list = [];
  for (const f of fs.readdirSync(QUIZ_DIR)) {
    if (!f.endsWith('.json')) continue;
    const q = readQuiz(f.slice(0, -5));
    if (q) list.push({ id: q.id, title: q.title, description: q.description, count: q.questions.length, updatedAt: q.updatedAt || '' });
  }
  list.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  res.json(list);
});

app.get('/api/quizzes/:id', requireHost, (req, res) => {
  const q = readQuiz(req.params.id);
  q ? res.json(q) : res.status(404).json({ error: 'ไม่พบแบบทดสอบ' });
});

app.post('/api/quizzes', requireHost, (req, res) => {
  let id = req.body && req.body.id;
  if (!validId(id)) id = 'q' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex');
  const quiz = sanitizeQuiz({ ...req.body, id });
  quiz.updatedAt = new Date().toISOString();
  fs.writeFileSync(quizPath(id), JSON.stringify(quiz, null, 2));
  res.json(quiz);
});

app.delete('/api/quizzes/:id', requireHost, (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'id ไม่ถูกต้อง' });
  try { fs.unlinkSync(quizPath(req.params.id)); } catch { /* ignore */ }
  res.json({ ok: true });
});

/* ---------------- อัปโหลดภาพ / เสียง ---------------- */
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname) || '').toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 8);
      cb(null, Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex') + ext);
    }
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
  // ไม่รับ SVG เพื่อกันสคริปต์แฝง
  fileFilter: (req, file, cb) => cb(null, /^(image|audio)\//.test(file.mimetype) && !/svg/.test(file.mimetype))
});
app.post('/api/upload', requireHost, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'รองรับเฉพาะไฟล์ภาพ (jpg/png/gif/webp) หรือไฟล์เสียง' });
  res.json({ url: '/uploads/' + req.file.filename, type: req.file.mimetype });
});

/* ---------------- QR code ---------------- */
app.get('/api/qr', async (req, res) => {
  try {
    const text = String(req.query.text || '').slice(0, 500);
    const size = Math.min(1024, Math.max(128, parseInt(req.query.size) || 400));
    const png = await QRCode.toBuffer(text || ' ', { width: size, margin: 1, color: { dark: '#2b1055', light: '#ffffff' } });
    res.type('png').send(png);
  } catch (e) { res.status(500).end(); }
});

/* ---------------- ผลการแข่งขัน CSV ---------------- */
app.get('/api/games/:pin/results.csv', (req, res) => {
  const g = games.get(req.params.pin);
  if (!g || g.token !== req.query.token) return res.status(404).send('not found');
  const esc = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const head = ['อันดับ', 'ชื่อ', 'คะแนน', 'ตอบถูก', 'จำนวนข้อ', 'โดนหักรอเพื่อน', 'เวลาเฉลี่ยข้อที่ถูก(วินาที)'];
  g.questions.forEach((_, i) => head.push('ข้อ' + (i + 1)));
  const rows = [head.map(esc).join(',')];
  ranking(g).forEach((p, i) => {
    const avg = p.correctCount ? (p.totalMs / p.correctCount / 1000).toFixed(2) : '';
    const r = [i + 1, p.name, p.score, p.correctCount, g.questions.length, p.waitCount, avg];
    g.questions.forEach((_, qi) => {
      const h = p.history.find(x => x.q === qi + 1);
      r.push(h ? (h.correct ? '✔ ' : '✘ ') + (h.pts - h.penalty) : '-');
    });
    rows.push(r.map(esc).join(','));
  });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="quiz-${g.pin}.csv"`);
  res.send('﻿' + rows.join('\r\n'));
});

/* ================= เกม ================= */
const games = new Map();
const AVATARS = ['🐶', '🐱', '🐼', '🦊', '🐸', '🐵', '🐯', '🦁', '🐷', '🐰', '🐨', '🐙', '🦄', '🐝', '🐢', '🐧', '🦖', '🐳', '🦉', '🐹'];
const DEFAULTS = { count: 0, shuffle: false, waitMode: true, waitStreak: 3, waitPenalty: 100, fastRatio: 0.5, showOnDevice: true, lateJoin: true };

function makePin() {
  let p;
  do { p = String(Math.floor(100000 + Math.random() * 900000)); } while (games.has(p));
  return p;
}
const clamp = (v, lo, hi, d) => { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
function cleanSettings(s = {}) {
  return {
    count: Math.round(clamp(s.count, 0, 200, 0)),
    shuffle: !!s.shuffle,
    waitMode: s.waitMode !== false,
    waitStreak: Math.round(clamp(s.waitStreak, 2, 10, 3)),
    waitPenalty: Math.round(clamp(s.waitPenalty, 0, 1000, 100)),
    fastRatio: clamp(s.fastRatio, 0.1, 1, 0.5),
    showOnDevice: s.showOnDevice !== false,
    lateJoin: s.lateJoin !== false
  };
}
function shuffleArr(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

const playerList = g => [...g.players.values()].map(p => ({ id: p.id, name: p.name, avatar: p.avatar, score: p.score, connected: p.connected }));
const ranking = g => [...g.players.values()].sort((a, b) => b.score - a.score || a.totalMs - b.totalMs);
const connected = g => [...g.players.values()].filter(p => p.connected);

/** ส่งให้จอผู้จัด — ถ้า keep=true จะจำไว้สำหรับกรณีผู้จัดรีเฟรชหน้า */
function emitHost(g, ev, data, keep = true) {
  if (keep) g.lastHost = { ev, data, at: Date.now() };
  io.to('host:' + g.pin).emit(ev, data);
}
function sendPlayer(p, ev, data) {
  p.last = { ev, data };
  if (p.socketId) io.to(p.socketId).emit(ev, data);
}
const allPlayers = (g, ev, data) => g.players.forEach(p => sendPlayer(p, ev, data));

function publicQuestion(g, forPlayer) {
  const q = g.questions[g.qIndex];
  const show = !forPlayer || g.settings.showOnDevice;
  return {
    index: g.qIndex, total: g.questions.length,
    text: show ? q.text : '', image: show ? q.image : '', audio: forPlayer ? '' : q.audio,
    options: show ? q.options : q.options.map(() => ''),
    time: q.time, double: q.double,
    remainMs: Math.max(0, q.time * 1000 - (Date.now() - g.qStart))
  };
}

function nextQuestion(g) {
  clearTimeout(g.timer);
  g.qIndex++;
  if (g.qIndex >= g.questions.length) return endGame(g);
  g.state = 'ready';
  g.answers = new Map();
  const q = g.questions[g.qIndex];
  const info = { index: g.qIndex, total: g.questions.length, double: q.double };
  emitHost(g, 'q:ready', info);
  allPlayers(g, 'q:ready', info);
  g.timer = setTimeout(() => showQuestion(g), 3500);
}

function showQuestion(g) {
  g.state = 'question';
  g.qStart = Date.now();
  const q = g.questions[g.qIndex];
  emitHost(g, 'q:show', { ...publicQuestion(g, false), answered: 0, players: connected(g).length });
  const pq = publicQuestion(g, true);
  g.players.forEach(p => sendPlayer(p, 'q:show', pq));
  g.timer = setTimeout(() => endQuestion(g), q.time * 1000 + 400);
}

function endQuestion(g) {
  if (g.state !== 'question') return;
  clearTimeout(g.timer);
  g.state = 'reveal';
  const q = g.questions[g.qIndex];
  const T = q.time * 1000;
  const counts = q.options.map(() => 0);
  const penalized = [];
  const fastest = [];
  const s = g.settings;

  for (const p of g.players.values()) {
    const a = g.answers.get(p.id);
    let pts = 0, penalty = 0, correct = false, fast = false;
    if (a) { counts[a.choice]++; correct = a.choice === q.correct; }
    if (correct) {
      const frac = a.ms / T;
      // ตอบถูก 500–1000 คะแนน ยิ่งเร็วยิ่งได้มาก (ข้อคะแนนคู่ x2)
      pts = Math.round(1000 * (1 - frac / 2)) * (q.double ? 2 : 1);
      fast = frac <= s.fastRatio;
      p.correctStreak++; p.correctCount++; p.totalMs += a.ms;
      p.fastStreak = fast ? p.fastStreak + 1 : 0;
      fastest.push({ name: p.name, avatar: p.avatar, ms: a.ms });
    } else {
      p.correctStreak = 0; p.fastStreak = 0;
    }
    // โหมดรอเพื่อน: ตอบถูกและเร็วติดกันครบ N ข้อ → หักคะแนน
    if (s.waitMode && p.fastStreak >= s.waitStreak) {
      penalty = s.waitPenalty;
      p.fastStreak = 0;
      p.waitCount++;
      penalized.push({ name: p.name, avatar: p.avatar });
    }
    p.score = Math.max(0, p.score + pts - penalty);
    p.history.push({ q: g.qIndex + 1, answer: a ? a.choice : null, correct, ms: a ? a.ms : null, pts, penalty });
    p._res = { answered: !!a, choice: a ? a.choice : null, correct, fast, pts, penalty, ms: a ? a.ms : null };
  }

  const ranked = ranking(g);
  ranked.forEach((p, i) => { p.rank = i + 1; });
  const last = g.qIndex === g.questions.length - 1;
  for (const p of ranked) {
    const ahead = p.rank > 1 ? ranked[p.rank - 2] : null;
    sendPlayer(p, 'q:result', {
      ...p._res, score: p.score, rank: p.rank, totalPlayers: ranked.length,
      correctStreak: p.correctStreak, fastStreak: p.fastStreak,
      waitMode: s.waitMode, waitStreak: s.waitStreak, waitPenalty: s.waitPenalty,
      correctIndex: q.correct, correctText: q.options[q.correct],
      behind: ahead ? { name: ahead.name, gap: ahead.score - p.score } : null,
      index: g.qIndex, total: g.questions.length, last
    });
  }
  fastest.sort((a, b) => a.ms - b.ms);
  emitHost(g, 'q:reveal', {
    index: g.qIndex, total: g.questions.length, text: q.text, image: q.image,
    options: q.options, correct: q.correct, counts, answered: g.answers.size,
    players: ranked.length, penalized, fastest: fastest.slice(0, 3), waitPenalty: s.waitPenalty, last
  });
}

function showBoard(g) {
  g.state = 'board';
  const r = ranking(g);
  emitHost(g, 'board', {
    index: g.qIndex, total: g.questions.length,
    top: r.slice(0, 10).map(p => ({ name: p.name, avatar: p.avatar, score: p.score, streak: p.correctStreak, fastStreak: p.fastStreak }))
  });
  r.forEach((p, i) => sendPlayer(p, 'board', { rank: i + 1, score: p.score, totalPlayers: r.length }));
}

function endGame(g) {
  clearTimeout(g.timer);
  g.state = 'end';
  const r = ranking(g);
  const podium = r.slice(0, 10).map(p => ({ name: p.name, avatar: p.avatar, score: p.score, correct: p.correctCount, waits: p.waitCount }));
  emitHost(g, 'game:end', { podium, players: r.length, total: g.questions.length });
  r.forEach((p, i) => sendPlayer(p, 'game:end', {
    rank: i + 1, score: p.score, totalPlayers: r.length, correct: p.correctCount,
    total: g.questions.length, waits: p.waitCount, podium: podium.slice(0, 3)
  }));
}

function maybeAllAnswered(g) {
  if (g.state !== 'question') return;
  const c = connected(g);
  if (c.length && c.every(p => g.answers.has(p.id))) setTimeout(() => endQuestion(g), 600);
}

io.on('connection', socket => {
  const hostGame = () => {
    const d = socket.data;
    if (!d || d.role !== 'host') return null;
    const g = games.get(d.pin);
    if (g) g.lastActive = Date.now();
    return g;
  };

  socket.on('host:create', (msg = {}, cb = () => {}) => {
    if (!checkKey(msg.key)) return cb({ error: 'รหัสผู้จัดไม่ถูกต้อง' });
    const quiz = readQuiz(msg.quizId);
    if (!quiz) return cb({ error: 'ไม่พบแบบทดสอบ' });
    let qs = quiz.questions.filter(q => (q.text || q.image || q.audio) && q.options.some(o => o.trim()));
    if (!qs.length) return cb({ error: 'แบบทดสอบนี้ยังไม่มีคำถาม' });
    const s = cleanSettings(msg.settings);
    if (s.shuffle) qs = shuffleArr([...qs]);
    qs = qs.slice(0, s.count > 0 ? Math.min(s.count, qs.length) : qs.length);
    s.count = qs.length;

    const origin = typeof msg.origin === 'string' && /^https?:\/\/[^\s/]+$/i.test(msg.origin) ? msg.origin : '';
    const pin = makePin();
    const g = {
      pin, token: crypto.randomBytes(16).toString('hex'),
      quiz: { id: quiz.id, title: quiz.title }, questions: qs, settings: s,
      players: new Map(), state: 'lobby', qIndex: -1, answers: new Map(), timer: null,
      lastActive: Date.now(), lastHost: null,
      joinUrl: (PUBLIC_URL || origin) + '/play.html?pin=' + pin
    };
    games.set(pin, g);
    socket.data = { role: 'host', pin };
    socket.join('host:' + pin);
    cb({ ok: true, pin, token: g.token, joinUrl: g.joinUrl, title: quiz.title, total: qs.length, settings: s });
  });

  socket.on('host:rejoin', (msg = {}, cb = () => {}) => {
    const g = games.get(String(msg.pin || ''));
    if (!g || g.token !== msg.token) return cb({ error: 'ห้องหมดอายุแล้ว' });
    socket.data = { role: 'host', pin: g.pin };
    socket.join('host:' + g.pin);
    let last = g.lastHost;
    if (last && last.ev === 'q:show') last = { ev: 'q:show', data: { ...publicQuestion(g, false), answered: g.answers.size, players: connected(g).length } };
    cb({ ok: true, pin: g.pin, token: g.token, joinUrl: g.joinUrl, title: g.quiz.title, total: g.questions.length, settings: g.settings, state: g.state, players: playerList(g), last });
  });

  socket.on('host:next', () => {
    const g = hostGame(); if (!g) return;
    if (g.state === 'lobby' || g.state === 'board') nextQuestion(g);
    else if (g.state === 'reveal') (g.qIndex >= g.questions.length - 1) ? endGame(g) : showBoard(g);
  });
  socket.on('host:skip', () => { const g = hostGame(); if (g) endQuestion(g); });
  socket.on('host:end', () => { const g = hostGame(); if (g && g.state !== 'end') endGame(g); });
  socket.on('host:kick', ({ playerId } = {}) => {
    const g = hostGame(); if (!g) return;
    const p = g.players.get(playerId); if (!p) return;
    g.players.delete(playerId);
    if (p.socketId) io.to(p.socketId).emit('kicked');
    emitHost(g, 'players', playerList(g), false);
    maybeAllAnswered(g);
  });

  socket.on('player:join', (msg = {}, cb = () => {}) => {
    const g = games.get(String(msg.pin || '').trim());
    if (!g) return cb({ error: 'ไม่พบห้องเกมนี้ ตรวจสอบ PIN อีกครั้งนะ' });
    g.lastActive = Date.now();
    let p = msg.playerId && g.players.get(msg.playerId);
    if (p) {
      p.socketId = socket.id; p.connected = true;
    } else {
      if (g.state === 'end') return cb({ error: 'เกมนี้จบไปแล้ว' });
      if (g.state !== 'lobby' && !g.settings.lateJoin) return cb({ error: 'เกมเริ่มไปแล้ว เข้าร่วมไม่ได้' });
      const name = String(msg.name || '').replace(/[<>]/g, '').trim().replace(/\s+/g, ' ').slice(0, 20);
      if (!name) return cb({ error: 'กรุณาตั้งชื่อก่อนนะ' });
      if ([...g.players.values()].some(x => x.name.toLowerCase() === name.toLowerCase())) return cb({ error: 'ชื่อนี้มีคนใช้แล้ว ลองชื่ออื่นนะ' });
      if (g.players.size >= MAX_PLAYERS) return cb({ error: 'ห้องเต็มแล้ว' });
      p = {
        id: crypto.randomUUID(), name, avatar: AVATARS.includes(msg.avatar) ? msg.avatar : AVATARS[g.players.size % AVATARS.length],
        score: 0, fastStreak: 0, correctStreak: 0, correctCount: 0, waitCount: 0, totalMs: 0,
        socketId: socket.id, connected: true, history: [], last: null
      };
      g.players.set(p.id, p);
    }
    socket.data = { role: 'player', pin: g.pin, playerId: p.id };
    socket.join('play:' + g.pin);
    const s = g.settings;
    cb({ ok: true, playerId: p.id, name: p.name, avatar: p.avatar, title: g.quiz.title, score: p.score,
      settings: { waitMode: s.waitMode, waitStreak: s.waitStreak, waitPenalty: s.waitPenalty, total: g.questions.length } });
    emitHost(g, 'players', playerList(g), false);

    // ส่งสถานะปัจจุบันให้ผู้เล่น (กรณีเข้ากลางเกม/เชื่อมต่อใหม่)
    if (g.state === 'question') {
      if (g.answers.has(p.id)) sendPlayer(p, 'answer:ok', { choice: g.answers.get(p.id).choice });
      else sendPlayer(p, 'q:show', publicQuestion(g, true));
    } else if (g.state === 'lobby' || !p.last) {
      sendPlayer(p, 'lobby', {});
    } else {
      io.to(socket.id).emit(p.last.ev, p.last.data);
    }
  });

  socket.on('player:answer', (msg = {}) => {
    const d = socket.data || {};
    const g = games.get(d.pin);
    if (!g || g.state !== 'question') return;
    const p = g.players.get(d.playerId);
    if (!p || g.answers.has(p.id)) return;
    const q = g.questions[g.qIndex];
    const choice = parseInt(msg.choice);
    if (!(choice >= 0 && choice < q.options.length)) return;
    const ms = Math.min(Date.now() - g.qStart, q.time * 1000);
    g.answers.set(p.id, { choice, ms });
    sendPlayer(p, 'answer:ok', { choice });
    emitHost(g, 'q:answered', { count: g.answers.size, players: connected(g).length }, false);
    maybeAllAnswered(g);
  });

  socket.on('disconnect', () => {
    const d = socket.data || {};
    if (d.role !== 'player') return;
    const g = games.get(d.pin); if (!g) return;
    const p = g.players.get(d.playerId);
    if (p && p.socketId === socket.id) {
      p.connected = false;
      emitHost(g, 'players', playerList(g), false);
      maybeAllAnswered(g);
    }
  });
});

// ลบห้องที่ไม่มีความเคลื่อนไหวเกิน 3 ชั่วโมง
setInterval(() => {
  const now = Date.now();
  for (const [pin, g] of games) if (now - g.lastActive > 3 * 3600e3) { clearTimeout(g.timer); games.delete(pin); }
}, 10 * 60e3).unref();

if (require.main === module) {
  server.listen(PORT, () => console.log(`🎉 Quiz Party พร้อมที่ http://localhost:${PORT}  (ผู้จัด: /host.html)`));
}
module.exports = { server, games };
