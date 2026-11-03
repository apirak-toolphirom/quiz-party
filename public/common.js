/* ของใช้ร่วมกัน: เสียงเอฟเฟกต์ (สังเคราะห์ด้วย WebAudio ไม่ต้องมีไฟล์), พลุกระดาษ, ตัวช่วยต่าง ๆ */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SHAPES = ['▲', '◆', '●', '■'];
const AVATARS = ['🐶', '🐱', '🐼', '🦊', '🐸', '🐵', '🐯', '🦁', '🐷', '🐰', '🐨', '🐙', '🦄', '🐝', '🐢', '🐧', '🦖', '🐳', '🦉', '🐹'];

function toast(msg, ms = 2200) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), ms);
}

const Sound = {
  ctx: null, on: true, music: null,
  init() {
    try {
      if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch { /* no audio */ }
  },
  tone(freq, dur = 0.15, type = 'sine', vol = 0.18, delay = 0) {
    if (!this.on || !this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.ctx.destination); o.start(t); o.stop(t + dur + 0.02);
  },
  seq(notes, step = 0.12, type = 'triangle', vol = 0.18) { notes.forEach((f, i) => f && this.tone(f, step * 1.4, type, vol, i * step)); },
  tick() { this.tone(1200, 0.04, 'square', 0.05); },
  tock() { this.tone(700, 0.08, 'square', 0.08); },
  pop() { this.tone(660, 0.08, 'sine', 0.2); this.tone(990, 0.08, 'sine', 0.15, 0.05); },
  go() { this.seq([523, 659, 784, 1047], 0.09, 'square', 0.12); },
  correct() { this.seq([659, 784, 1047, 1319], 0.08, 'triangle', 0.22); },
  wrong() { this.tone(260, 0.25, 'sawtooth', 0.12); this.tone(180, 0.35, 'sawtooth', 0.12, 0.18); },
  turtle() { this.seq([392, 349, 330, 294, 262], 0.14, 'sine', 0.2); },
  timeup() { this.tone(440, 0.5, 'square', 0.1); this.tone(220, 0.6, 'square', 0.1, 0.1); },
  fanfare() { this.seq([523, 523, 523, 659, 0, 784, 0, 1047, 1047], 0.13, 'square', 0.13); },
  startMusic() {
    this.init(); if (this.music) return;
    const mel = [523, 659, 784, 659, 587, 698, 880, 698, 523, 659, 784, 1047, 988, 784, 659, 587];
    const bass = [131, 0, 196, 0, 147, 0, 220, 0, 131, 0, 196, 0, 165, 0, 196, 0];
    let i = 0;
    this.music = setInterval(() => {
      this.tone(mel[i % 16], 0.16, 'triangle', 0.07);
      if (bass[i % 16]) this.tone(bass[i % 16], 0.25, 'sine', 0.12);
      i++;
    }, 190);
  },
  stopMusic() { clearInterval(this.music); this.music = null; }
};
['pointerdown', 'keydown'].forEach(e => window.addEventListener(e, () => Sound.init(), { once: true }));

function confetti(ms = 3500) {
  const c = document.createElement('canvas');
  c.className = 'confetti'; document.body.appendChild(c);
  const ctx = c.getContext('2d');
  const W = c.width = innerWidth, H = c.height = innerHeight;
  const colors = ['#ff4d6d', '#ffbe0b', '#3a86ff', '#06d6a0', '#8338ec', '#ff006e', '#fb5607'];
  const P = Array.from({ length: Math.min(220, W / 4) }, () => ({
    x: Math.random() * W, y: -20 - Math.random() * H * 0.5, w: 6 + Math.random() * 8, h: 8 + Math.random() * 10,
    vx: -2 + Math.random() * 4, vy: 2 + Math.random() * 4, r: Math.random() * 6, vr: -0.2 + Math.random() * 0.4,
    c: colors[(Math.random() * colors.length) | 0]
  }));
  const t0 = performance.now();
  (function frame(t) {
    ctx.clearRect(0, 0, W, H);
    P.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.vy += 0.05; p.r += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
    });
    if (t - t0 < ms) requestAnimationFrame(frame); else c.remove();
  })(t0);
}

/** ตัวจับเวลาถอยหลัง เรียก onTick(วินาทีที่เหลือ, สัดส่วน) */
function countdown(totalMs, remainMs, onTick, onDone) {
  const end = performance.now() + remainMs;
  let lastSec = -1, stopped = false;
  (function loop() {
    if (stopped) return;
    const left = Math.max(0, end - performance.now());
    const sec = Math.ceil(left / 1000);
    onTick(sec, left / totalMs, sec !== lastSec);
    lastSec = sec;
    if (left > 0) requestAnimationFrame(loop); else onDone && onDone();
  })();
  return () => { stopped = true; };
}
