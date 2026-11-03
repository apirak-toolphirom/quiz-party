/* ============ ผู้เล่น (มือถือ) ============ */
const socket = io();
const params = new URLSearchParams(location.search);
let me = null;            // { pin, playerId, name, avatar, settings }
let myAvatar = localStorage.getItem('qp_avatar') || AVATARS[(Math.random() * AVATARS.length) | 0];
let stopTimer = null;
let score = 0;
const msg = $('#v-msg');

$('#inPin').value = params.get('pin') || '';
$('#inName').value = localStorage.getItem('qp_name') || '';
if ($('#inPin').value) setTimeout(() => $('#inName').focus(), 200);

function renderAv() {
  $('#avpick').innerHTML = AVATARS.map(a => `<button type="button" class="${a === myAvatar ? 'sel' : ''}" data-av="${a}">${a}</button>`).join('');
}
$('#avpick').onclick = e => { const b = e.target.closest('[data-av]'); if (b) { myAvatar = b.dataset.av; renderAv(); Sound.pop(); } };
renderAv();

function view(html) {
  if (stopTimer) { stopTimer(); stopTimer = null; }
  $('#v-join').classList.remove('active');
  msg.classList.remove('active'); void msg.offsetWidth;
  msg.innerHTML = html; msg.classList.add('active');
}
function head() {
  if (!me) return;
  $('#hName').textContent = me.avatar + ' ' + me.name;
  $('#hScore').textContent = score.toLocaleString() + ' คะแนน';
}
const vibrate = p => navigator.vibrate && navigator.vibrate(p);

function join(pin, name, playerId) {
  socket.emit('player:join', { pin, name, playerId, avatar: myAvatar }, res => {
    if (res.error) {
      if (playerId) { localStorage.removeItem('qp_pid_' + pin); return; } // รีจอยน์ไม่สำเร็จ → ให้ใส่ชื่อใหม่
      toast(res.error, 3000); vibrate(200); return;
    }
    me = { pin, playerId: res.playerId, name: res.name, avatar: res.avatar, settings: res.settings, title: res.title };
    score = res.score || 0;
    localStorage.setItem('qp_pid_' + pin, res.playerId);
    localStorage.setItem('qp_name', res.name);
    localStorage.setItem('qp_avatar', res.avatar);
    history.replaceState(null, '', '?pin=' + pin);
    head();
  });
}
$('#btnJoin').onclick = () => {
  Sound.init();
  const pin = $('#inPin').value.replace(/\D/g, ''), name = $('#inName').value.trim();
  if (pin.length !== 6) return toast('PIN ต้องมี 6 หลัก');
  if (!name) return toast('ตั้งชื่อก่อนนะ 😊');
  join(pin, name);
};
$('#inName').onkeydown = e => { if (e.key === 'Enter') $('#btnJoin').click(); };

// กลับเข้าห้องเดิมอัตโนมัติ (รีเฟรช/เน็ตหลุด)
socket.on('connect', () => {
  const pin = me ? me.pin : params.get('pin');
  const pid = me ? me.playerId : (pin && localStorage.getItem('qp_pid_' + pin));
  if (pin && pid) join(pin, '', pid);
});
socket.on('disconnect', () => me && toast('📡 การเชื่อมต่อหลุด กำลังเชื่อมใหม่...', 4000));

socket.on('kicked', () => {
  if (me) localStorage.removeItem('qp_pid_' + me.pin);
  me = null;
  view(`<div class="bigmsg"><div class="emo">👋</div><h2>คุณถูกนำออกจากห้อง</h2><a class="btn yellow" href="play.html">กลับหน้าเข้าเล่น</a></div>`);
});

socket.on('lobby', () => {
  const s = me ? me.settings : {};
  view(`<div class="bigmsg">
    <div class="emo bounce">${me ? me.avatar : '🎉'}</div>
    <h2>เข้าห้องแล้ว! 🎉</h2>
    <p style="font-size:20px">เห็นชื่อตัวเองบนจอไหม? รอผู้จัดเริ่มเกมนะ</p>
    <div class="card" style="color:var(--ink);text-align:left">
      <b>${esc(me ? me.title : '')}</b>
      <div>📝 ${s.total || '-'} ข้อ</div>
      <div>⚡ ตอบถูกยิ่งเร็วยิ่งได้คะแนนมาก (500–1,000)</div>
      ${s.waitMode ? `<div>🐢 <b>โหมดรอเพื่อน:</b> ตอบถูกและเร็วติดกัน ${s.waitStreak} ข้อ จะโดนหัก ${s.waitPenalty} คะแนน ให้เพื่อนตามทัน!</div>` : ''}
    </div>
  </div>`);
});

socket.on('q:ready', d => {
  $('#hInfo').textContent = `ข้อ ${d.index + 1}/${d.total}`;
  view(`<div class="bigmsg"><h2>ข้อ ${d.index + 1}</h2>${d.double ? '<div class="badge-x2">⭐ คะแนน x2 ⭐</div>' : ''}<div class="emo wobble">⏳</div><h2>เตรียมตัว!</h2></div>`);
  vibrate(60);
});

socket.on('q:show', d => {
  $('#hInfo').textContent = `ข้อ ${d.index + 1}/${d.total}`;
  const opts = d.options.map((o, i) => ({ o, i })).filter(x => x.o.trim() || !d.options.some(y => y.trim()));
  const hasText = d.options.some(o => o.trim());
  view(`
    <div class="tbar"><i id="tb"></i></div>
    ${d.text || d.image ? `<div class="pq">${esc(d.text)}${d.image ? `<img src="${esc(d.image)}" alt="">` : ''}</div>` : '<div class="bigmsg" style="font-size:18px">👀 ดูคำถามบนจอใหญ่</div>'}
    <div class="answers ${opts.length <= 2 ? 'n2' : ''}">
      ${opts.map(({ o, i }) => `<button class="abtn opt${i}" data-c="${i}"><span class="shape">${SHAPES[i]}</span>${hasText ? esc(o) : ''}</button>`).join('')}
    </div>`);
  $$('.abtn').forEach(b => b.onclick = () => {
    Sound.pop(); vibrate(40);
    socket.emit('player:answer', { choice: +b.dataset.c });
    $$('.abtn').forEach(x => { x.disabled = true; x.style.opacity = x === b ? 1 : .3; });
  });
  const tb = $('#tb');
  stopTimer = countdown(d.time * 1000, d.remainMs, (sec, frac) => { tb.style.width = (frac * 100) + '%'; });
});

const WAIT_MSGS = ['คำตอบถูกส่งแล้ว! รอเพื่อน ๆ แป๊บนึง', 'ไวมาก! ลุ้นกันว่าจะถูกไหม', 'ส่งแล้ว! ภาวนาไว้ก่อน 🙏', 'เรียบร้อย! เพื่อนยังคิดอยู่เลย 😆'];
socket.on('answer:ok', d => {
  view(`<div class="bigmsg"><div class="emo bounce">${['🤞', '🚀', '😎', '🙏'][d.choice % 4]}</div>
    <h2>${WAIT_MSGS[(Math.random() * WAIT_MSGS.length) | 0]}</h2>
    <div class="abtn opt${d.choice}" style="width:120px;height:120px;margin:0 auto;border-radius:24px"><span class="shape">${SHAPES[d.choice]}</span></div>
  </div>`);
});

function streakHtml(r) {
  if (!r.waitMode) return '';
  const n = r.waitStreak, k = r.fastStreak;
  const icons = Array.from({ length: n }, (_, i) => `<span class="${i < k ? '' : 'off'}">⚡</span>`).join('');
  const hint = k === n - 1 ? `<div style="font-weight:600;color:#ff006e">ระวัง! ตอบถูกเร็วอีกข้อ จะโดนหัก ${r.waitPenalty} 🐢</div>` : '';
  return `<div class="card center" style="padding:12px"><div class="muted" style="font-size:14px">ตอบถูกและเร็วติดกัน</div><div class="streak">${icons}</div>${hint}</div>`;
}

socket.on('q:result', r => {
  score = r.score; head();
  const cls = !r.answered ? 'none' : r.correct ? 'good' : 'bad';
  const emo = !r.answered ? '⌛' : r.correct ? (r.fast ? '⚡' : '✅') : '❌';
  const title = !r.answered ? 'หมดเวลา!' : r.correct ? (r.fast ? 'ถูกต้อง! ไวสุด ๆ' : 'ถูกต้อง!') : 'ยังไม่ถูกนะ';
  const behind = r.behind ? `ตามหลัง ${esc(r.behind.name)} อยู่ ${r.behind.gap.toLocaleString()} คะแนน` : (r.totalPlayers > 1 ? 'คุณอยู่อันดับ 1! 👑' : '');
  view(`
    <div class="result ${cls}">
      <div class="emo">${emo}</div>
      <h2 style="margin:4px 0">${title}</h2>
      ${r.correct ? `<div class="pts">+${r.pts.toLocaleString()}</div>` : `<div style="font-size:18px">คำตอบที่ถูก: <b>${SHAPES[r.correctIndex]} ${esc(r.correctText)}</b></div>`}
      ${r.correct && r.correctStreak >= 2 ? `<div style="margin-top:8px;font-size:20px">🔥 ตอบถูกติดกัน ${r.correctStreak} ข้อ</div>` : ''}
    </div>
    ${r.penalty ? `<div class="waitcard"><div class="emo wobble">🐢</div><h2 style="margin:0">โหมดรอเพื่อน!</h2>
      <div>เก่งเกินไปแล้ว ตอบถูกเร็วติดกัน ${r.waitStreak} ข้อ</div><div class="pts" style="background:#ffe3e9;color:#c9184a">−${r.penalty} คะแนน</div><div class="muted">รอเพื่อนตามมาหน่อยนะ 😆</div></div>` : streakHtml(r)}
    <div class="scorebar"><span>อันดับ ${r.rank}/${r.totalPlayers}</span><span>${r.score.toLocaleString()} คะแนน</span></div>
    ${behind ? `<div class="bigmsg" style="font-size:16px">${behind}</div>` : ''}`);
  if (r.penalty) { Sound.turtle(); vibrate([100, 80, 100, 80, 300]); }
  else if (r.correct) { Sound.correct(); vibrate(80); if (r.fast) confetti(1500); }
  else { Sound.wrong(); vibrate([200, 100, 200]); }
});

socket.on('board', b => {
  score = b.score; head();
  view(`<div class="bigmsg"><div class="emo bounce">${b.rank === 1 ? '👑' : b.rank <= 3 ? '🏅' : '📊'}</div>
    <h2>อันดับ ${b.rank} จาก ${b.totalPlayers}</h2><div class="scorebar"><span>คะแนนรวม</span><span>${b.score.toLocaleString()}</span></div>
    <p>ดูตารางคะแนนบนจอใหญ่ 👀</p></div>`);
});

socket.on('game:end', e => {
  score = e.score; head();
  const medal = ['🥇', '🥈', '🥉'][e.rank - 1] || '🎉';
  view(`<div class="bigmsg">
    <div class="emo bounce">${medal}</div>
    <h2>${e.rank <= 3 ? 'สุดยอด! ติดอันดับ ' + e.rank : 'จบเกมแล้ว! อันดับ ' + e.rank}</h2>
    <div class="scorebar"><span>คะแนนรวม</span><span>${e.score.toLocaleString()}</span></div>
    <div class="card" style="color:var(--ink);margin-top:12px">
      <div>✅ ตอบถูก ${e.correct}/${e.total} ข้อ</div>
      ${e.waits ? `<div>🐢 โดนโหมดรอเพื่อน ${e.waits} ครั้ง</div>` : ''}
      <div style="margin-top:8px"><b>ผู้ชนะ</b>: ${e.podium.map((p, i) => ['🥇', '🥈', '🥉'][i] + ' ' + p.avatar + ' ' + esc(p.name)).join(' ')}</div>
    </div>
    <a class="btn yellow" href="play.html" style="margin-top:14px">เล่นเกมใหม่</a>
  </div>`);
  if (me) localStorage.removeItem('qp_pid_' + me.pin);
  if (e.rank <= 3) { Sound.fanfare(); confetti(4000); }
});
