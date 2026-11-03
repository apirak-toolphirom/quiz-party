// ทดสอบการไหลของเกม: สร้างห้อง → ผู้เล่น 2 คน → คะแนนตามความเร็ว → โหมดรอเพื่อน
const os = require('os'), fs = require('fs'), path = require('path'), assert = require('assert');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'qp-'));
process.env.PORT = 0;
const { server } = require('../server');
const { io } = require('socket.io-client');

const wait = (s, ev) => new Promise(r => s.once(ev, r));
const emitAck = (s, ev, d) => new Promise(r => s.emit(ev, d, r));

server.listen(0, async () => {
  const url = 'http://localhost:' + server.address().port;
  const host = io(url), a = io(url), b = io(url);
  try {
    const qr = await fetch(url + '/api/qr?text=hello'); assert.equal(qr.headers.get('content-type'), 'image/png');
    const list = await (await fetch(url + '/api/quizzes')).json();
    assert.ok(list.length >= 1, 'มีแบบทดสอบตัวอย่าง');
    const quiz = await (await fetch(url + '/api/quizzes/sample-fun')).json();

    const room = await emitAck(host, 'host:create', { quizId: 'sample-fun', settings: { count: 4, waitStreak: 3, waitPenalty: 100 }, origin: 'http://192.168.1.10:3000' });
    assert.ok(room.ok, JSON.stringify(room)); assert.equal(room.total, 4);
    assert.equal(room.joinUrl, 'http://192.168.1.10:3000/play.html?pin=' + room.pin);

    const ja = await emitAck(a, 'player:join', { pin: room.pin, name: 'Alice', avatar: '🦊' });
    const dup = await emitAck(b, 'player:join', { pin: room.pin, name: 'alice' });
    assert.ok(dup.error, 'ชื่อซ้ำต้องไม่ผ่าน');
    await emitAck(b, 'player:join', { pin: room.pin, name: 'Bob' });

    const results = { a: [], b: [] };
    a.on('q:result', r => results.a.push(r)); b.on('q:result', r => results.b.push(r));
    a.on('q:show', () => a.emit('player:answer', { choice: quiz.questions[results.a.length].correct }));
    b.on('q:show', d => setTimeout(() => b.emit('player:answer', { choice: (quiz.questions[results.b.length].correct + 1) % d.options.length }), 300));

    let reveal;
    host.emit('host:next');
    for (let i = 0; i < 4; i++) {
      reveal = await wait(host, 'q:reveal');
      console.log(`ข้อ ${i + 1}: counts=${reveal.counts} penalized=${reveal.penalized.map(p => p.name)}`);
      host.emit('host:next');
      if (!reveal.last) { await wait(host, 'board'); host.emit('host:next'); }
    }
    const end = await wait(host, 'game:end');
    console.log('ผลสุดท้าย:', end.podium.map(p => `${p.name}=${p.score}`).join(', '));

    assert.ok(results.a.every(r => r.correct && r.pts > 900), 'Alice ตอบถูกเร็วได้ >900');
    assert.equal(results.a[2].penalty, 100, 'ข้อที่ 3 Alice โดนหักรอเพื่อน');
    assert.equal(results.a[3].penalty, 0, 'หลังโดนหักเริ่มนับใหม่');
    assert.ok(results.b.every(r => !r.correct && r.pts === 0), 'Bob ตอบผิด');
    assert.equal(end.podium[0].name, 'Alice'); assert.equal(end.podium[0].waits, 1);

    const csv = await (await fetch(`${url}/api/games/${room.pin}/results.csv?token=${room.token}`)).text();
    assert.ok(csv.includes('Alice') && csv.includes('Bob'));
    console.log('✅ ผ่านทุกข้อ');
    process.exit(0);
  } catch (e) { console.error('❌', e); process.exit(1); }
});
