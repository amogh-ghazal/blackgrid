import http from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { createRoom, createSocialRoom, addHuman, removeHuman, acceptInput, action, tick, snapshot } from './simulation.js';
import { maintenancePage } from './maintenance.js';
import { MAX_PLAYERS, TICK_RATE, clamp } from '../shared/world.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAINTENANCE = process.env.BLACKGRID_MAINTENANCE === '1';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.webm': 'video/webm', '.mp4': 'video/mp4' };
const safeText = (value, fallback, max) => typeof value === 'string' ? value.replace(/[<>\u0000-\u001f\u007f]/g, '').trim().slice(0, max) || fallback : fallback;
const send = (socket, data) => { if (socket.readyState === WebSocket.OPEN && socket.bufferedAmount < 256000) socket.send(JSON.stringify(data)); };
export async function createGameServer({ dev = false, persist = false, maxRooms = 8 } = {}) {
  const rooms = new Map();
  const hubs = new Map();
  const sockets = new Set();
  const perIp = new Map();
  let memory = { shots: 0, lights: 0, escapes: 0 }, tickCost = 0, saving = false;
  const dataDir = process.env.DATA_DIR || path.join(ROOT, 'data');
  if (persist) {
    try { const saved = JSON.parse(await readFile(path.join(dataDir, 'learning.json'), 'utf8')); for (const key of Object.keys(memory)) memory[key] = clamp(Number(saved[key]) || 0, 0, 10000); }
    catch (error) { if (error.code !== 'ENOENT') console.warn('Learning save unavailable; starting with baseline behaviour.'); }
  }
  const vite = dev ? await (await import('vite')).createServer({ root: ROOT, server: { middlewareMode: true }, appType: 'spa' }) : null;
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(self), geolocation=()');
    if (!dev) res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; font-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'");
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { res.writeHead(400).end(); return; }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
    if (url.pathname === '/api/health') { res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify({ status: 'ok', maintenance: MAINTENANCE, rooms: rooms.size, players: [...rooms.values(), ...hubs.values()].reduce((n, r) => n + [...r.players.values()].filter(p => !p.bot).length, 0), tickMs: Math.round(tickCost * 100) / 100, maxRooms, protocol: 1 })); return; }
    if (MAINTENANCE) {
      const nonce = randomBytes(18).toString('base64');
      res.statusCode = 503; res.setHeader('Retry-After', '600'); res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Security-Policy', `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
      res.end(req.method === 'HEAD' ? undefined : maintenancePage(nonce)); return;
    }
    if (url.pathname === '/api/rooms') {
      res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify([...rooms.values()].map(r => ({ code: r.code, title: r.title, humans: [...r.players.values()].filter(p => !p.bot).length, crew: r.players.size, max: MAX_PLAYERS, stage: r.stage, phase: r.phase, adaptation: r.adaptation })))); return;
    }
    if (vite) { vite.middlewares(req, res); return; }
    try {
      const root = path.join(ROOT, 'dist');
      const file = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
      if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
      const ext = path.extname(file);
      if (!MIME[ext]) { res.writeHead(404).end(); return; }
      const content = await readFile(file);
      res.setHeader('Content-Type', MIME[ext]);
      res.setHeader('Cache-Control', file.includes(path.sep + 'assets' + path.sep) ? 'public, max-age=31536000, immutable' : 'no-cache');
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch { res.writeHead(404).end('Not found'); }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: { threshold: 1024, serverNoContextTakeover: true, clientNoContextTakeover: true, serverMaxWindowBits: 10, concurrencyLimit: 4, zlibDeflateOptions: { level: 3, memLevel: 5 } } });
  server.on('upgrade', (req, socket, head) => {
    if (MAINTENANCE) { socket.write('HTTP/1.1 503 Service Unavailable\r\nRetry-After: 600\r\nConnection: close\r\n\r\n'); socket.destroy(); return; }
    if (req.url !== '/socket') { if (!dev) socket.destroy(); return; }
    const ip = req.headers['cf-connecting-ip'] || req.socket.remoteAddress;
    if (sockets.size >= 2048 || (perIp.get(ip) || 0) >= 64) { socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n'); socket.destroy(); return; }
    if (req.headers.origin) {
      let origin;
      try { origin = new URL(req.headers.origin); } catch { socket.destroy(); return; }
      const allow = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
      if (origin.host !== req.headers.host && !allow.includes(origin.origin)) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return; }
    }
    wss.handleUpgrade(req, socket, head, ws => { ws.clientIp = ip; wss.emit('connection', ws, req); });
  });
  wss.on('connection', (ws, req) => {
    const ip = ws.clientIp || req.socket.remoteAddress;
    perIp.set(ip, (perIp.get(ip) || 0) + 1);
    sockets.add(ws);
    ws.id = randomUUID(); ws.room = null; ws.tokens = 100; ws.lastToken = Date.now(); ws.alive = true; ws.joined = false;
    ws.on('error', () => {});
    ws.on('pong', () => { ws.alive = true; });
    const joinTimeout = setTimeout(() => { if (!ws.joined) ws.close(1008, 'Join timeout'); }, 15000);
    joinTimeout.unref();
    ws.on('message', raw => {
      const now = Date.now();
      ws.tokens = Math.min(100, ws.tokens + (now - ws.lastToken) * 0.06); ws.lastToken = now;
      if (--ws.tokens < 0) { ws.close(1008, 'Rate limit'); return; }
      let message;
      try { message = JSON.parse(raw.toString()); } catch { ws.close(1003, 'Invalid JSON'); return; }
      if (!message || typeof message !== 'object' || Array.isArray(message)) return;
      if (message.type === 'ping') { send(ws, { type: 'pong', at: typeof message.at === 'number' && Number.isFinite(message.at) ? message.at : 0 }); return; }
      if (message.type === 'join' && !ws.joined) {
        const code = typeof message.code === 'string' ? message.code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) : '';
        const name = safeText(message.name, '', 16);
        if (!name) { send(ws, { type: 'error', message: 'Choose a name before joining the operation.' }); return; }
        let room = code ? (rooms.get(code) || hubs.get(code)) : null;
        if (code && !room) { send(ws, { type: 'error', message: 'Operation not found. Check the room code.' }); return; }
        if (room && room.phase !== 'active' && room.phase !== 'hub') { send(ws, { type: 'error', message: 'This operation has ended. Create a new operation.' }); return; }
        if (!room) {
          if (rooms.size >= maxRooms) { send(ws, { type: 'error', message: 'This host is at capacity. Join an existing operation or try another host.' }); return; }
          let id;
          do { id = randomBytes(4).toString('hex').slice(0, 6).toUpperCase(); } while (rooms.has(id) || hubs.has(id));
          const crew = [1, 5, 10, 15].includes(message.crew) ? message.crew : 5;
          room = createRoom(id, safeText(message.title, 'Nightfall operation', 32), crew, memory);
          rooms.set(id, room);
        }
        const p = addHuman(room, ws.id, name);
        if (!p) { send(ws, { type: 'error', message: 'This operation is full (15 humans).' }); return; }
        ws.room = room; ws.joined = true; ws.binaryState = message.binaryState === true; clearTimeout(joinTimeout);
        send(ws, { type: 'welcome', id: ws.id, code: room.code, state: snapshot(room) });
        return;
      }
      if (!ws.room) return;
      const p = ws.room.players.get(ws.id);
      if (!p) return;
      if (message.type === 'chat') {
        const text = safeText(message.text, '', 120);
        if (!text) return;
        for (const peer of sockets) if (peer.room === ws.room) send(peer, { type: 'chat', from: ws.id, name: p.name, text });
        return;
      }
      if (message.type === 'voice-ready') {
        for (const peer of sockets) if (peer !== ws && peer.room === ws.room) send(peer, { type: 'voice-ready', from: ws.id });
        return;
      }
      if (message.type === 'voice-left') {
        for (const peer of sockets) if (peer !== ws && peer.room === ws.room) send(peer, { type: 'voice-left', from: ws.id });
        return;
      }
      if (message.type === 'signal' && typeof message.to === 'string' && message.signal && typeof message.signal === 'object') {
        const peer = [...sockets].find(s => s.id === message.to && s.room === ws.room && s.readyState === WebSocket.OPEN);
        if (peer) send(peer, { type: 'signal', from: ws.id, signal: message.signal });
        return;
      }
      if (message.type === 'input') acceptInput(p, message, ws.room.time);
      if (message.type === 'action' && typeof message.action === 'string') action(ws.room, p, message.action, message.yaw);
      if (message.type === 'action' && ws.room.social) return;
      if (message.type === 'action' && ws.room.phase === 'won') {
        const oldRoom = ws.room;
        const peers = [...sockets].filter(s => s.room === oldRoom && s.readyState === WebSocket.OPEN);
        let hub = [...hubs.values()].find(candidate => candidate.players.size < MAX_PLAYERS);
        if (!hub) {
          let hubCode;
          do { hubCode = randomBytes(4).toString('hex').slice(0, 6).toUpperCase(); } while (rooms.has(hubCode) || hubs.has(hubCode));
          hub = createSocialRoom(hubCode, memory); hubs.set(hubCode, hub);
        }
        for (const peer of peers) {
          const previous = oldRoom.players.get(peer.id);
          if (!previous) continue;
          removeHuman(oldRoom, peer.id);
          addHuman(hub, peer.id, previous.name);
          peer.room = hub;
          send(peer, { type: 'welcome', id: peer.id, code: hub.code, state: snapshot(hub) });
        }
        return;
      }
      if (message.type === 'restart' && ws.room.owner === ws.id && ws.room.phase !== 'active') {
        const old = ws.room;
        const next = createRoom(old.code, old.title, old.targetSize, old.learning);
        rooms.set(old.code, next);
        for (const peer of sockets) if (peer.room === old) { const previous = old.players.get(peer.id); peer.room = next; addHuman(next, peer.id, previous?.name || 'Guest'); send(peer, { type: 'welcome', id: peer.id, code: next.code, state: snapshot(next) }); }
      }
    });
    ws.on('close', () => {
      clearTimeout(joinTimeout); sockets.delete(ws);
      const count = (perIp.get(ip) || 1) - 1;
      if (count) perIp.set(ip, count); else perIp.delete(ip);
      if (ws.room) { for (const peer of sockets) if (peer.room === ws.room) send(peer, { type: 'voice-left', from: ws.id }); removeHuman(ws.room, ws.id); ws.room.lastActive = Date.now(); }
    });
  });
  let frame = 0;
  const loop = setInterval(() => {
    const started = performance.now();
    for (const room of [...rooms.values(), ...hubs.values()]) {
      const connected = [...sockets].filter(s => s.room === room && s.readyState === WebSocket.OPEN);
      if (!connected.length) { if (Date.now() - room.lastActive > 60000) { for (const key of Object.keys(memory)) memory[key] = Math.max(memory[key], room.learning[key]); (room.social ? hubs : rooms).delete(room.code); } continue; }
      room.lastActive = Date.now();
      tick(room, 1 / TICK_RATE);
      if (frame % 2 === 0) {
        const state = snapshot(room);
        state.events = state.events.filter(event => event.id > (room.broadcastEventId || 0));
        room.broadcastEventId = room.eventId;
        const payload = JSON.stringify({ type: 'state', state });
        const compressed = connected.some(s => s.binaryState) ? gzipSync(payload, { level: 3 }) : null;
        for (const s of connected) {
          if (s.bufferedAmount > 1024 * 1024) s.close(1013, 'Connection too slow');
          else if (s.bufferedAmount < 128000) s.send(s.binaryState ? compressed : payload, { binary: Boolean(s.binaryState), compress: !s.binaryState });
        }
      }
    }
    frame++; tickCost = tickCost * 0.9 + (performance.now() - started) * 0.1;
  }, 1000 / TICK_RATE);
  loop.unref();
  const heartbeat = setInterval(() => { for (const s of sockets) { if (!s.alive) s.terminate(); else { s.alive = false; s.ping(); } } }, 20000);
  heartbeat.unref();
  async function save() {
    if (!persist || saving) return;
    saving = true;
    try {
      for (const room of rooms.values()) for (const key of Object.keys(memory)) memory[key] = Math.max(memory[key], room.learning[key]);
      await mkdir(dataDir, { recursive: true });
      await writeFile(path.join(dataDir, 'learning.tmp'), JSON.stringify(memory));
      await rename(path.join(dataDir, 'learning.tmp'), path.join(dataDir, 'learning.json'));
    } catch { console.warn('Could not persist anonymous adaptation counters.'); }
    finally { saving = false; }
  }
  const autosave = setInterval(save, 30000); autosave.unref();
  return { server, rooms, hubs, wss, listen: (port = 3000, host = '127.0.0.1') => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => resolve(server.address())); }), close: async () => { clearInterval(loop); clearInterval(heartbeat); clearInterval(autosave); for (const s of sockets) s.terminate(); await save(); await vite?.close(); await new Promise(resolve => wss.close(resolve)); if (server.listening) await new Promise(resolve => server.close(resolve)); } };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await createGameServer({ dev: process.argv.includes('--dev'), persist: process.env.PERSIST_LEARNING !== '0', maxRooms: clamp(Number(process.env.MAX_ROOMS) || 8, 1, 128) });
  const port = Number(process.env.PORT) || 3000;
  await app.listen(port, process.env.HOST || '127.0.0.1');
  console.log(`BLACKGRID ready at http://localhost:${port} | up to 15 humans per operation | host-authoritative`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); process.exit(0); });
}
