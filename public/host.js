/* ============ ผู้จัดเกม ============ */
let hostKey = localStorage.getItem('qp_hostKey') || '';
let editing = null;          // แบบทดสอบที่กำลังแก้ไข
let setupQuiz = null;        // แบบทดสอบที่จะเล่น
let room = null;             // { pin, token, joinUrl, title, total, settings }
let players = [];
let stopTimer = null;
let currentAudio = null;
const socket = io({ autoConnect: true });

function show(id) {
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'v-' + id));
  scrollTo(0, 0);
}
$$('[data-go]').forEach(b => b.onclick = () => { show(b.dataset.go); if (b.dataset.go === 'home') loadList(); });

async function api(url, opts = {}) {
  opts.headers = { ...(opts.headers || {}), 'x-host-key': hostKey };
  const r = await fetch(url, opts);
  if (r.status === 401) {
    const k = prompt('ใส่รหัสผู้จัด (HOST_KEY)');
    if (k === null) throw new Error('ต้องใช้รหัสผู้จัด');
    hostKey = k; localStorage.setItem('qp_hostKey', k);
    return api(url, opts);
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || r.statusText);
  return data;
}
const jsonOpts = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/* ---------------- คลังแบบทดสอบ ---------------- */
async function loadList() {
  const box = $('#quizList');
  try {
    const list = await api('/api/quizzes');
    box.innerHTML = list.length ? list.map(q => `
      <div class="quizcard">
        <h3>${esc(q.title)}</h3>
        <div class="muted">${q.count} ข้อ ${q.description ? '• ' + esc(q.description) : ''}</div>
        <div class="actions">
          <button class="btn pink" data-play="${q.id}">▶ เล่น</button>
          <button class="btn ghost" data-edit="${q.id}">✏️ แก้ไข</button>
          <button class="btn ghost" data-dup="${q.id}">📄 ทำสำเนา</button>
          <button class="btn ghost" data-del="${q.id}">🗑</button>
        </div>
      </div>`).join('') : `<div class="card center"><div style="font-size:64px">📝</div><h2>ยังไม่มีแบบทดสอบ</h2><p class="muted">กด "สร้างแบบทดสอบ" เพื่อเริ่ม</p></div>`;
  } catch (e) { box.innerHTML = `<div class="card">${esc(e.message)}</div>`; }
}
$('#quizList').onclick = async e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.play) openSetup(await api('/api/quizzes/' + b.dataset.play));
  if (b.dataset.edit) openEditor(await api('/api/quizzes/' + b.dataset.edit));
  if (b.dataset.dup) {
    const q = await api('/api/quizzes/' + b.dataset.dup);
    delete q.id; q.title += ' (สำเนา)';
    await api('/api/quizzes', jsonOpts('POST', q)); loadList(); toast('ทำสำเนาแล้ว');
  }
  if (b.dataset.del && confirm('ลบแบบทดสอบนี้?')) { await api('/api/quizzes/' + b.dataset.del, { method: 'DELETE' }); loadList(); }
};
$('#btnNew').onclick = () => openEditor({ title: '', description: '', questions: [newQ()] });
$('#importFile').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const q = JSON.parse(await f.text());
    delete q.id;
    await api('/api/quizzes', jsonOpts('POST', q));
    toast('นำเข้าแล้ว 🎉'); loadList();
  } catch (err) { toast('ไฟล์ไม่ถูกต้อง: ' + err.message); }
  e.target.value = '';
};

/* ---------------- แก้ไขแบบทดสอบ ---------------- */
const newQ = () => ({ text: '', image: '', audio: '', options: ['', '', '', ''], correct: 0, time: 20, double: false });
const TIMES = [5, 10, 15, 20, 30, 45, 60, 90, 120];

function openEditor(q) {
  editing = JSON.parse(JSON.stringify(q));
  $('#qTitle').value = editing.title || '';
  $('#qDesc').value = editing.description || '';
  renderQs(); show('editor');
}
$('#qTitle').oninput = e => editing.title = e.target.value;
$('#qDesc').oninput = e => editing.description = e.target.value;

function renderQs() {
  $('#qList').innerHTML = editing.questions.map((q, i) => `
  <div class="qcard" data-i="${i}">
    <div class="qhead">
      <span class="qnum">ข้อ ${i + 1}</span>
      <select data-k="time">${TIMES.map(t => `<option value="${t}" ${t == q.time ? 'selected' : ''}>⏱ ${t} วินาที</option>`).join('')}</select>
      <label class="chk"><input type="checkbox" data-k="double" ${q.double ? 'checked' : ''}> ⭐ คะแนน x2</label>
      <span class="grow"></span>
      <button class="btn sm ghost" data-a="up" title="เลื่อนขึ้น">↑</button>
      <button class="btn sm ghost" data-a="down" title="เลื่อนลง">↓</button>
      <button class="btn sm ghost" data-a="copy" title="ทำสำเนา">⧉</button>
      <button class="btn sm ghost" data-a="del" title="ลบ">🗑</button>
    </div>
    <textarea data-k="text" rows="2" placeholder="พิมพ์คำถาม...">${esc(q.text)}</textarea>
    <div class="media">
      <div class="mediabox">
        <b>🖼 ภาพประกอบ</b>
        ${q.image ? `<img src="${esc(q.image)}" alt="">` : ''}
        <div class="row">
          <label class="btn sm blue">อัปโหลดภาพ<input type="file" accept="image/*" data-up="image" hidden></label>
          ${q.image ? '<button class="btn sm ghost" data-a="clear-image">ลบภาพ</button>' : ''}
        </div>
      </div>
      <div class="mediabox">
        <b>🔊 เสียงประกอบ</b>
        ${q.audio ? `<audio controls src="${esc(q.audio)}"></audio>` : ''}
        <div class="row">
          <label class="btn sm blue">อัปโหลดเสียง<input type="file" accept="audio/*" data-up="audio" hidden></label>
          <button class="btn sm pink" data-a="rec">🎙 อัดเสียง</button>
          ${q.audio ? '<button class="btn sm ghost" data-a="clear-audio">ลบเสียง</button>' : ''}
        </div>
      </div>
    </div>
    <div class="opts">
      ${q.options.map((o, j) => `
        <div class="optedit opt${j}">
          <input type="radio" name="c${i}" data-correct="${j}" ${q.correct === j ? 'checked' : ''} title="คำตอบที่ถูก">
          <span class="shape">${SHAPES[j]}</span>
          <input type="text" data-opt="${j}" value="${esc(o)}" placeholder="ตัวเลือก ${j + 1}${j > 1 ? ' (ไม่ใส่ก็ได้)' : ''}">
          ${q.options.length > 2 ? `<button class="x" data-a="rmopt" data-j="${j}" title="ลบตัวเลือก">✕</button>` : ''}
        </div>`).join('')}
    </div>
    <div class="row" style="margin-top:10px">
      ${q.options.length < 4 ? '<button class="btn sm ghost" data-a="addopt">＋ เพิ่มตัวเลือก</button>' : ''}
      <button class="btn sm ghost" data-a="tf">ทำเป็น ถูก/ผิด</button>
    </div>
  </div>`).join('');
}

const qOf = el => { const c = el.closest('.qcard'); return c ? +c.dataset.i : -1; };
$('#qList').addEventListener('input', e => {
  const i = qOf(e.target); if (i < 0) return;
  const q = editing.questions[i], t = e.target;
  if (t.dataset.k === 'text') q.text = t.value;
  if (t.dataset.opt != null) q.options[+t.dataset.opt] = t.value;
});
$('#qList').addEventListener('change', async e => {
  const i = qOf(e.target); if (i < 0) return;
  const q = editing.questions[i], t = e.target;
  if (t.dataset.k === 'time') q.time = +t.value;
  if (t.dataset.k === 'double') q.double = t.checked;
  if (t.dataset.correct != null) q.correct = +t.dataset.correct;
  if (t.dataset.up) {
    const f = t.files[0]; if (!f) return;
    try { q[t.dataset.up] = await uploadFile(f); renderQs(); } catch (err) { toast(err.message); }
  }
});
$('#qList').addEventListener('click', e => {
  const b = e.target.closest('[data-a]'); if (!b) return;
  const i = qOf(b), qs = editing.questions, q = qs[i];
  switch (b.dataset.a) {
    case 'up': if (i > 0) [qs[i - 1], qs[i]] = [qs[i], qs[i - 1]]; break;
    case 'down': if (i < qs.length - 1) [qs[i + 1], qs[i]] = [qs[i], qs[i + 1]]; break;
    case 'copy': qs.splice(i + 1, 0, JSON.parse(JSON.stringify(q))); break;
    case 'del': if (!confirm('ลบข้อ ' + (i + 1) + '?')) return; qs.splice(i, 1); break;
    case 'clear-image': q.image = ''; break;
    case 'clear-audio': q.audio = ''; break;
    case 'addopt': q.options.push(''); break;
    case 'rmopt': { const j = +b.dataset.j; q.options.splice(j, 1); if (q.correct >= q.options.length) q.correct = 0; else if (q.correct > j) q.correct--; break; }
    case 'tf': q.options = ['ถูก', 'ผิด']; if (q.correct > 1) q.correct = 0; break;
    case 'rec': return toggleRecord(b, q);
  }
  renderQs();
});
$('#btnAddQ').onclick = () => { editing.questions.push(newQ()); renderQs(); setTimeout(() => scrollTo(0, document.body.scrollHeight), 50); };
$('#btnBack').onclick = () => { if (confirm('กลับโดยไม่บันทึก?')) { show('home'); loadList(); } };

async function uploadFile(file) {
  if (file.size > 25 * 1024 * 1024) throw new Error('ไฟล์ใหญ่เกิน 25MB');
  const fd = new FormData(); fd.append('file', file, file.name || 'file');
  toast('กำลังอัปโหลด...');
  const r = await api('/api/upload', { method: 'POST', body: fd });
  toast('อัปโหลดแล้ว ✅');
  return r.url;
}

let recorder = null;
async function toggleRecord(btn, q) {
  if (recorder) { recorder.stop(); return; }
  if (!navigator.mediaDevices || !window.MediaRecorder) return toast('เบราว์เซอร์นี้อัดเสียงไม่ได้ (ต้องเปิดผ่าน https หรือ localhost)');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = e => chunks.push(e.data);
    recorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      const type = recorder.mimeType || 'audio/webm';
      recorder = null;
      const blob = new Blob(chunks, { type });
      const ext = type.includes('mp4') ? '.m4a' : type.includes('ogg') ? '.ogg' : '.webm';
      try { q.audio = await uploadFile(new File([blob], 'record' + ext, { type: type.split(';')[0] })); } catch (err) { toast(err.message); }
      renderQs();
    };
    recorder.start();
    btn.textContent = '⏹ หยุดอัด'; btn.classList.add('rec');
  } catch (err) { toast('เปิดไมค์ไม่ได้: ' + err.message); }
}

function validateQuiz() {
  for (const [i, q] of editing.questions.entries()) {
    if (!q.text.trim() && !q.image && !q.audio) return `ข้อ ${i + 1} ยังไม่มีคำถาม`;
    if (!q.options[q.correct] || !q.options[q.correct].trim()) return `ข้อ ${i + 1}: คำตอบที่ถูกยังว่างอยู่`;
    if (q.options.filter(o => o.trim()).length < 2) return `ข้อ ${i + 1}: ต้องมีตัวเลือกอย่างน้อย 2 ข้อ`;
  }
  return '';
}
async function saveQuiz() {
  if (!editing.title.trim()) editing.title = 'แบบทดสอบใหม่';
  const err = validateQuiz(); if (err) { toast('⚠️ ' + err, 3500); return null; }
  // ตัดตัวเลือกว่างท้าย ๆ ออก
  editing.questions.forEach(q => {
    while (q.options.length > 2 && !q.options[q.options.length - 1].trim() && q.correct !== q.options.length - 1) q.options.pop();
  });
  const saved = await api('/api/quizzes', jsonOpts('POST', editing));
  editing.id = saved.id;
  toast('บันทึกแล้ว 💾');
  return saved;
}
$('#btnSave').onclick = () => saveQuiz().catch(e => toast(e.message));
$('#btnPlayFromEdit').onclick = async () => { const s = await saveQuiz().catch(e => toast(e.message)); if (s) openSetup(s); };
$('#btnExport').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(editing, null, 2)], { type: 'application/json' }));
  a.download = (editing.title || 'quiz') + '.json'; a.click();
};

/* ---------------- ตั้งค่าเกม ---------------- */
function openSetup(q) {
  setupQuiz = q;
  const n = q.questions.length;
  $('#setupTitle').textContent = '⚙️ ' + q.title;
  $('#setupInfo').textContent = `มีทั้งหมด ${n} ข้อ — เลือกจำนวนข้อที่ต้องการเล่นได้ (ติ๊ก "สุ่ม" เพื่อสุ่มเลือกข้อ)`;
  const c = $('#sCount'); c.max = n; c.value = n;
  show('setup');
}
$('#btnCreateRoom').onclick = () => {
  Sound.init();
  const settings = {
    count: +$('#sCount').value, shuffle: $('#sShuffle').checked,
    waitMode: $('#sWait').checked, waitStreak: +$('#sWaitStreak').value, waitPenalty: +$('#sWaitPenalty').value,
    fastRatio: (+$('#sFast').value || 50) / 100, showOnDevice: $('#sShow').checked, lateJoin: $('#sLate').checked
  };
  socket.emit('host:create', { key: hostKey, quizId: setupQuiz.id, settings, origin: location.origin }, res => {
    if (res.error) return toast(res.error);
    setRoom(res); players = []; renderLobby(); show('lobby');
  });
};

/* ---------------- ล็อบบี้ ---------------- */
function setRoom(r) {
  room = r;
  sessionStorage.setItem('qp_room', JSON.stringify({ pin: r.pin, token: r.token }));
  $('#lobbyPin').textContent = r.pin;
  $('#joinUrl').textContent = r.joinUrl;
  $('#qrImg').src = '/api/qr?size=600&text=' + encodeURIComponent(r.joinUrl);
  $('#lobbyTitle').textContent = r.title;
  const s = r.settings;
  $('#lobbyRule').innerHTML = `📝 ${r.total} ข้อ • ⚡ ตอบถูกยิ่งเร็วยิ่งได้คะแนน` +
    (s.waitMode ? ` • 🐢 โหมดรอเพื่อน: ตอบถูกและเร็วติดกัน ${s.waitStreak} ข้อ หัก ${s.waitPenalty} คะแนน` : '');
  if (/localhost|127\.0\.0\.1/.test(r.joinUrl)) toast('⚠️ ลิงก์เป็น localhost มือถือจะเข้าไม่ได้ — เปิดหน้านี้ด้วย IP เครื่อง หรือตั้ง PUBLIC_URL', 6000);
}
function renderLobby() {
  const box = $('#lobbyPlayers');
  box.innerHTML = players.map(p => `<span class="chip ${p.connected ? '' : 'off'}" data-kick="${p.id}" title="แตะเพื่อเตะออก">${p.avatar} ${esc(p.name)}</span>`).join('');
  const on = players.filter(p => p.connected).length;
  $('#lobbyCount').textContent = on + ' คน';
  $('#lobbyEmpty').classList.toggle('hidden', players.length > 0);
  $('#btnStart').disabled = on === 0;
}
$('#lobbyPlayers').onclick = e => {
  const c = e.target.closest('[data-kick]'); if (!c) return;
  const p = players.find(x => x.id === c.dataset.kick);
  if (p && confirm(`เตะ "${p.name}" ออกจากห้อง?`)) socket.emit('host:kick', { playerId: p.id });
};
$('#btnCopy').onclick = () => navigator.clipboard.writeText(room.joinUrl).then(() => toast('คัดลอกแล้ว'));
$('#btnMusic').onclick = () => { Sound.music ? Sound.stopMusic() : Sound.startMusic(); };
$('#btnStart').onclick = () => { Sound.stopMusic(); Sound.go(); socket.emit('host:next'); };

socket.on('players', list => {
  const before = players.length;
  players = list;
  if (list.length > before) Sound.pop();
  renderLobby();
});

/* ---------------- จอเกม ---------------- */
const stage = $('#stage');
function stopAll() { if (stopTimer) { stopTimer(); stopTimer = null; } if (currentAudio) { currentAudio.pause(); currentAudio = null; } }
const footer = (left, right) => `<div class="footer-bar"><span>${left}</span><span>PIN ${room ? room.pin : ''}</span><span class="row">${right}</span></div>`;

socket.on('q:ready', d => {
  stopAll(); show('stage');
  stage.innerHTML = `
    <div class="ready-screen"><div>
      <div style="font-size:32px;font-weight:600">ข้อ ${d.index + 1} / ${d.total}</div>
      ${d.double ? '<div class="badge-x2" style="margin:10px 0">⭐ คะแนน x2 ⭐</div>' : ''}
      <div class="big" id="cd">3</div>
      <div style="font-size:26px">เตรียมตัว! 🚀</div>
    </div></div>`;
  let n = 3; Sound.tock();
  const h = setInterval(() => {
    n--; const el = $('#cd'); if (!el || n <= 0) return clearInterval(h);
    el.textContent = n; el.style.animation = 'none'; el.offsetHeight; el.style.animation = ''; Sound.tock();
  }, 1000);
});

socket.on('q:show', d => {
  stopAll(); show('stage');
  stage.innerHTML = `
    <div class="qtext">${esc(d.text) || '🔊 ฟังเสียงแล้วตอบ'}</div>
    <div class="qmid">
      <div class="timer" id="tm"><span>${d.time}</span></div>
      <div class="img">${d.image ? `<img src="${esc(d.image)}" alt="">` : (d.double ? '<div class="badge-x2">⭐ คะแนน x2</div>' : '<div style="font-size:120px" class="bounce">🤔</div>')}
        ${d.audio ? `<div style="margin-top:10px"><button class="btn yellow" id="btnReplay">🔊 เล่นเสียงอีกครั้ง</button></div>` : ''}
      </div>
      <div class="answered"><span id="ansCount">${d.answered}</span><small>คนตอบแล้ว / ${d.players}</small></div>
    </div>
    <div class="tiles">${d.options.map((o, i) => o.trim() ? `<div class="tile opt${i}"><span class="shape">${SHAPES[i]}</span>${esc(o)}</div>` : '').join('')}</div>
    ${footer(`ข้อ ${d.index + 1}/${d.total}`, '<button class="btn sm ghost" id="btnSkip">⏭ ข้ามเวลา</button>')}`;
  $('#btnSkip').onclick = () => socket.emit('host:skip');
  if (d.audio) {
    currentAudio = new Audio(d.audio);
    currentAudio.play().catch(() => toast('กดปุ่ม 🔊 เพื่อเล่นเสียง'));
    $('#btnReplay').onclick = () => { currentAudio.currentTime = 0; currentAudio.play(); };
  }
  const tm = $('#tm');
  stopTimer = countdown(d.time * 1000, d.remainMs, (sec, frac, changed) => {
    tm.style.setProperty('--p', (frac * 100) + '%');
    tm.firstElementChild.textContent = sec;
    tm.classList.toggle('hurry', sec <= 5 && sec > 0);
    if (changed && sec <= 5 && sec > 0) Sound.tick();
  }, () => Sound.timeup());
});

socket.on('q:answered', d => { const el = $('#ansCount'); if (el) { el.textContent = d.count; Sound.tick(); } });

socket.on('q:reveal', d => {
  stopAll(); show('stage');
  const max = Math.max(1, ...d.counts);
  const rightPct = d.players ? Math.round(d.counts[d.correct] / d.players * 100) : 0;
  stage.innerHTML = `
    <div class="qtext">${esc(d.text) || 'เฉลย'}</div>
    <div class="row" style="align-items:stretch">
      <div class="panel grow center">
        <div class="bars">${d.counts.map((c, i) => d.options[i].trim() ? `
          <div class="bar opt${i} ${i === d.correct ? '' : 'dim'}" style="height:0" data-h="${Math.max(12, c / max * 100)}%">
            ${c}<span class="shape" style="font-size:22px">${i === d.correct ? '✔' : SHAPES[i]}</span></div>` : '').join('')}
        </div>
        <div class="muted" style="margin-top:6px">ตอบถูก ${rightPct}% (${d.counts[d.correct]} จาก ${d.players} คน)</div>
      </div>
      <div class="panel" style="min-width:260px">
        <h3>⚡ ตอบถูกเร็วสุด</h3>
        ${d.fastest.length ? d.fastest.map((f, i) => `<div style="font-size:20px">${['🥇', '🥈', '🥉'][i]} ${f.avatar} ${esc(f.name)} <span class="muted">${(f.ms / 1000).toFixed(2)} วิ</span></div>`).join('') : '<div class="muted">ยังไม่มีใครตอบถูก 😅</div>'}
      </div>
    </div>
    ${d.penalized.length ? `<div class="turtle-banner">🐢 โหมดรอเพื่อน! เก่งเกินไปแล้ว ขอหัก ${d.waitPenalty} คะแนนให้เพื่อนตามทัน: ${d.penalized.map(p => p.avatar + ' ' + esc(p.name)).join(', ')}</div>` : ''}
    <div class="tiles">${d.options.map((o, i) => o.trim() ? `<div class="tile opt${i} ${i === d.correct ? 'ok' : 'dim'}"><span class="shape">${i === d.correct ? '✔' : SHAPES[i]}</span>${esc(o)}<span class="cnt">${d.counts[i]}</span></div>` : '').join('')}</div>
    ${footer(`ข้อ ${d.index + 1}/${d.total}`, `<button class="btn yellow big" id="btnNext">${d.last ? '🏆 ดูผลสุดท้าย' : '📊 ตารางคะแนน'}</button>`)}`;
  requestAnimationFrame(() => setTimeout(() => $$('.bar').forEach(b => b.style.height = b.dataset.h), 50));
  d.counts[d.correct] ? Sound.correct() : Sound.wrong();
  if (d.penalized.length) setTimeout(() => Sound.turtle(), 700);
  $('#btnNext').onclick = () => socket.emit('host:next');
});

socket.on('board', d => {
  stopAll(); show('stage');
  stage.innerHTML = `
    <h1 class="center" style="color:#fff;text-shadow:0 4px 0 rgba(0,0,0,.2)">🏅 ตารางคะแนน</h1>
    <div class="board">${d.top.map((p, i) => `
      <div class="brow" style="animation-delay:${i * 0.08}s"><span class="rk">${i + 1}</span><span style="font-size:30px">${p.avatar}</span>
        <span>${esc(p.name)} ${p.streak >= 2 ? `<span class="fire">🔥${p.streak}</span>` : ''}</span><span class="sc">${p.score.toLocaleString()}</span></div>`).join('') || '<div class="panel center">ยังไม่มีผู้เล่น</div>'}
    </div>
    <span class="grow"></span>
    ${footer(`ข้อ ${d.index + 1}/${d.total}`, '<button class="btn sm ghost" id="btnEnd">⏹ จบเกม</button> <button class="btn yellow big" id="btnNext">ข้อต่อไป ➜</button>')}`;
  $('#btnNext').onclick = () => socket.emit('host:next');
  $('#btnEnd').onclick = () => confirm('จบเกมตอนนี้เลย?') && socket.emit('host:end');
});

socket.on('game:end', d => {
  stopAll(); show('stage');
  const [a, b, c] = d.podium;
  const pod = (p, cls, n) => p ? `<div class="pod ${cls}"><div class="av">${p.avatar}</div><div class="nm">${esc(p.name)}</div><div>${p.score.toLocaleString()} คะแนน</div><div class="blk">${n}</div></div>` : '';
  stage.innerHTML = `
    <h1 class="center logo">🏆 ผู้ชนะ!</h1>
    <div class="podium">${pod(b, 'p2', 2)}${pod(a, 'p1', 1)}${pod(c, 'p3', 3)}</div>
    <div class="board">${d.podium.slice(3).map((p, i) => `<div class="brow"><span class="rk">${i + 4}</span><span style="font-size:26px">${p.avatar}</span><span>${esc(p.name)}</span><span class="sc">${p.score.toLocaleString()}</span></div>`).join('')}</div>
    <div class="row" style="justify-content:center;margin-top:10px">
      <a class="btn blue" href="/api/games/${room.pin}/results.csv?token=${room.token}">📥 ดาวน์โหลดผล (CSV)</a>
      <button class="btn ghost" id="btnAgain">🔁 เล่นอีกรอบ</button>
      <button class="btn yellow" id="btnHome">🏠 หน้าหลัก</button>
    </div>`;
  Sound.fanfare(); setTimeout(() => confetti(5000), 1500);
  $('#btnHome').onclick = () => { sessionStorage.removeItem('qp_room'); room = null; show('home'); loadList(); };
  $('#btnAgain').onclick = () => { sessionStorage.removeItem('qp_room'); if (setupQuiz) openSetup(setupQuiz); else { show('home'); loadList(); } };
});

/* ---------------- เชื่อมต่อใหม่ (รีเฟรชหน้า / เน็ตหลุด) ---------------- */
const REPLAY = { 'q:ready': 1, 'q:show': 1, 'q:reveal': 1, 'board': 1, 'game:end': 1 };
socket.on('connect', () => {
  const saved = JSON.parse(sessionStorage.getItem('qp_room') || 'null');
  if (!saved) return;
  socket.emit('host:rejoin', saved, res => {
    if (res.error) { sessionStorage.removeItem('qp_room'); return; }
    setRoom(res); players = res.players; renderLobby();
    if (res.state === 'lobby' || !res.last) show('lobby');
    else if (REPLAY[res.last.ev]) socket.listeners(res.last.ev).forEach(fn => fn(res.last.data));
  });
});

loadList();
