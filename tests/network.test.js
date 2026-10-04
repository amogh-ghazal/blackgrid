import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { gunzipSync } from 'node:zlib';
import { createGameServer } from '../server/index.js';

function next(ws, type) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.off('message', onMessage); reject(new Error(`Timed out waiting for ${type}`)); }, 5000);
    function onMessage(raw) { const msg = JSON.parse(raw); if (msg.type === type) { clearTimeout(timer); ws.off('message', onMessage); resolve(msg); } }
    ws.on('message', onMessage);
  });
}
async function connect(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/socket`);
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  return ws;
}
async function join(ws, data = {}) {
  const result = next(ws, 'welcome');
  ws.send(JSON.stringify({ type: 'join', name: 'Tester', crew: 1, ...data }));
  return result;
}
test('real WebSocket clients share rooms, isolated sessions, authoritative movement and heartbeat', async () => {
  const app = await createGameServer();
  const { port } = await app.listen(0);
  const clients = [];
  try {
    const a = await connect(port), b = await connect(port), c = await connect(port); clients.push(a, b, c);
    const wa = await join(a);
    assert.match(a.extensions, /permessage-deflate/);
    const wb = await join(b, { code: wa.code, name: '<script>Guest</script>' });
    const wc = await join(c);
    assert.equal(wa.code, wb.code); assert.notEqual(wa.code, wc.code);
    const room = app.rooms.get(wa.code); room.zombies = [];
    assert.equal(room.players.size, 2);
    assert.equal(room.players.get(wb.id).name.includes('<'), false);
    const chat = next(b, 'chat'); a.send(JSON.stringify({ type: 'chat', text: 'Ready?' }));
    assert.equal((await chat).text, 'Ready?');
    const ready = next(b, 'voice-ready'); a.send(JSON.stringify({ type: 'voice-ready' }));
    assert.equal((await ready).from, wa.id);
    const signal = next(b, 'signal'); a.send(JSON.stringify({ type: 'signal', to: wb.id, signal: { candidate: { candidate: 'test' } } }));
    assert.equal((await signal).from, wa.id);
    a.send(JSON.stringify({ type: 'input', x: 99999, z: 0, yaw: 0, health: 99999 }));
    const update = await next(a, 'state');
    assert.ok(update.state.players.find(p => p.id === wa.id).health <= 100);
    const list = await (await fetch(`http://127.0.0.1:${port}/api/rooms`)).json();
    assert.equal(list.length, 2);
    const pong = next(a, 'pong'); a.send(JSON.stringify({ type: 'ping', at: 123 }));
    assert.equal((await pong).at, 123);
    const before = room.players.size;
    b.close(); await new Promise(resolve => b.once('close', resolve));
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(room.players.size, before - 1);
  } finally { for (const client of clients) client.terminate(); await app.close(); }
});
test('server rejects malformed JSON, invalid room codes and hostile browser origins', async () => {
  const app = await createGameServer();
  const { port } = await app.listen(0);
  let a;
  try {
    a = await connect(port);
    const error = next(a, 'error'); a.send(JSON.stringify({ type: 'join', name: 'Tester', code: 'NOPE00' }));
    assert.match((await error).message, /not found/);
    const closed = new Promise(resolve => a.once('close', resolve));
    a.send('{invalid'); assert.equal(await closed, 1003);
    const denied = new WebSocket(`ws://127.0.0.1:${port}/socket`, { origin: 'https://untrusted.example' });
    const message = await new Promise(resolve => denied.once('error', e => resolve(e.message)));
    assert.match(message, /403/);
    const previous = process.env.ALLOWED_ORIGINS;
    process.env.ALLOWED_ORIGINS = 'https://approved-proxy.example';
    try {
      const approved = new WebSocket(`ws://127.0.0.1:${port}/socket`, { origin: 'https://approved-proxy.example' });
      await new Promise((resolve, reject) => { approved.once('open', resolve); approved.once('error', reject); });
      const welcome = await join(approved);
      assert.ok(welcome.code);
      approved.terminate();
    } finally { if (previous === undefined) delete process.env.ALLOWED_ORIGINS; else process.env.ALLOWED_ORIGINS = previous; }
  } finally { a?.terminate(); await app.close(); }
});
test('binary snapshots reduce payload size without relying on WebSocket compression negotiation', async () => {
  const app = await createGameServer();
  const { port } = await app.listen(0);
  const ws = new WebSocket(`ws://127.0.0.1:${port}/socket`, { perMessageDeflate: false });
  try {
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    const received = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('No compressed snapshot')), 5000);
      ws.on('message', (raw, binary) => {
        if (!binary) return;
        try {
          const decoded = gunzipSync(raw).toString();
          const message = JSON.parse(decoded);
          assert.equal(message.type, 'state');
          assert.ok(raw.length < decoded.length * 0.6);
          assert.equal(message.state.players.length, 5);
          clearTimeout(timer); resolve();
        } catch (error) { clearTimeout(timer); reject(error); }
      });
    });
    ws.send(JSON.stringify({ type: 'join', name: 'Binary client', crew: 5, binaryState: true }));
    await received;
    assert.equal(ws.extensions, '');
  } finally { ws.terminate(); await app.close(); }
});
test('fifteen humans can join one room and a sixteenth is rejected', async () => {
  const app = await createGameServer();
  const { port } = await app.listen(0);
  const clients = [];
  try {
    let code;
    for (let i = 0; i < 15; i++) { const ws = await connect(port); clients.push(ws); const msg = await join(ws, { code, crew: 15 }); code = msg.code; }
    assert.equal(app.rooms.get(code).players.size, 15);
    const ws = await connect(port); clients.push(ws);
    const error = next(ws, 'error'); ws.send(JSON.stringify({ type: 'join', name: 'Tester', code }));
    assert.match((await error).message, /full/);
  } finally { for (const client of clients) client.terminate(); await app.close(); }
});
