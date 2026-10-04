import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createGameServer } from '../server/index.js';
import { createPlayer } from '../server/simulation.js';
import { WORLD } from '../shared/world.js';

const output = path.resolve('artifacts/marketing');
await mkdir(output, { recursive: true });
const app = await createGameServer({ dev: true, persist: false });
const { port } = await app.listen(0);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => {
  localStorage.setItem('blackgrid-settings', JSON.stringify({ quality: 'medium', volume: 80, motion: false, name: 'SIGNAL' }));
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function(destination, ...args) {
    if (destination === this.context.destination && !window.__audioTap) {
      window.__audioTap = this.context.createMediaStreamDestination();
      connect.call(this, window.__audioTap);
    }
    return connect.call(this, destination, ...args);
  };
});
const manifest = { title: 'BLACKGRID — Keep the light alive', disclosure: 'In-engine cinematics and staged gameplay captured from the early playable build. Game audio recorded directly from Web Audio; no microphone or desktop audio captured.', shots: [] };
let room, player;
async function wait(ms) { await page.waitForTimeout(ms); }
async function position(x, z, extra = {}) {
  Object.assign(player, { x, z, vehicle: null, health: 100, infected: false, infection: 0, dead: false, protection: room.time + 1000, batteries: 0, light: false, weapon: 'rifle', ammo: 30, reserve: 180, reloadAt: 0, input: { x: 0, z: 0, yaw: Math.PI, sprint: false, fire: false } }, extra);
  for (const c of room.cars) { c.driver = null; c.speed = 0; c.headlights = false; }
  room.power = 0; room.phase = 'active'; room.waveAt = room.time + 1000;
  room.zombies = []; room.events = []; room.noises = [];
  room.supplies = WORLD.supplies.map(s => ({ ...s }));
  let index = 0;
  for (const p of room.players.values()) if (p.bot) {
    Object.assign(p, { x: -18 + index++ * 3, z: 35, health: 100, infected: false, dead: false, infection: 0, protection: room.time + 1000, light: false, batteries: 0, ammo: 12, reserve: 60, path: null });
  }
  await wait(700);
}
function zombies(points) {
  room.zombies = points.map(([x, z], index) => ({ id: `media-${++room.eventId}`, x, z, yaw: 0, health: 90, attackAt: room.time + 100, memory: null, memoryUntil: 0, wanderAt: 0, variant: index % 3, alert: false, path: null }));
}
async function camera(mode) { await page.evaluate(mode => { window.__shotCamera = mode; window.__shotStart = performance.now(); }, mode); }
async function aim(x, z) {
  const point = await page.evaluate(({ x, z }) => {
    const p = window.__captureGame.aimPoint.clone().set(x, 1.1, z).project(window.__captureGame.camera);
    return { x: (p.x + 1) / 2 * innerWidth, y: (1 - p.y) / 2 * innerHeight };
  }, { x, z });
  await page.mouse.move(Math.max(5, Math.min(1595, point.x)), Math.max(5, Math.min(895, point.y)));
}
async function record(name, activity) {
  await page.evaluate(() => {
    const video = document.querySelector('#world').captureStream(30);
    const stream = new MediaStream([...video.getVideoTracks(), ...window.__audioTap.stream.getAudioTracks()]);
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ? 'video/webm;codecs=vp9,opus' : 'video/webm;codecs=vp8,opus';
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 10000000, audioBitsPerSecond: 192000 });
    const chunks = [];
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    window.__recording = { recorder, chunks, video, started: performance.now(), mimeType };
    recorder.start(250);
  });
  await activity();
  await page.keyboard.up('KeyW'); await page.keyboard.up('KeyS'); await page.keyboard.up('KeyA'); await page.keyboard.up('KeyD'); await page.mouse.up();
  const captured = await page.evaluate(async () => {
    const { recorder, chunks, video, started, mimeType } = window.__recording;
    await new Promise(resolve => { recorder.onstop = resolve; recorder.stop(); });
    video.getTracks().forEach(t => t.stop());
    const data = await new Promise(resolve => { const reader = new FileReader(); reader.onloadend = () => resolve(reader.result.slice(reader.result.indexOf('base64,') + 7)); reader.readAsDataURL(new Blob(chunks, { type: mimeType })); });
    return { data, duration: (performance.now() - started) / 1000, mimeType };
  });
  const bytes = Buffer.from(captured.data, 'base64');
  if (bytes.length < 10000 || bytes.subarray(0, 4).toString('hex') !== '1a45dfa3') throw new Error(`Invalid WebM capture for ${name}: ${bytes.length} bytes`);
  await writeFile(path.join(output, `${name}.webm`), bytes);
  manifest.shots.push({ name, duration: captured.duration, mimeType: captured.mimeType });
  console.log(`Captured ${name}: ${captured.duration.toFixed(1)}s`);
}
try {
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle', timeout: 90000 });
  await page.locator('#lobby').waitFor({ state: 'visible', timeout: 30000 });
  await page.evaluate(async () => {
    const { GameScene } = await import('/src/scene.js');
    const update = GameScene.prototype.update;
    GameScene.prototype.update = function(dt) { window.__captureGame = this; return update.call(this, dt); };
  });
  await page.waitForFunction(() => Boolean(window.__captureGame));
  await page.locator('#crew-size').selectOption('5'); await page.locator('#deploy').click();
  await page.locator('#hud').waitFor({ state: 'visible' });
  await page.waitForFunction(() => Boolean(window.__audioTap));
  const info = await page.evaluate(() => window.__BLACKGRID__.diagnostics);
  room = app.rooms.get(info.room); player = room.players.get(info.player);
  await page.evaluate(() => {
    const game = window.__captureGame;
    game.zoom = 0.8;
    const render = game.renderer.render.bind(game.renderer);
    game.renderer.render = function(scene, camera) {
      if (scene === game.scene && window.__shotCamera) {
        const t = (performance.now() - window.__shotStart) / 1000;
        if (window.__shotCamera === 'wide') {
          camera.position.set(22 + Math.sin(t * 0.07) * 3, 20 - t * 0.04, 39 - t * 0.2);
          camera.lookAt(-1, 2.5, -11);
        }
        if (window.__shotCamera === 'poster') {
          camera.position.set(9, 12.5, 31);
          camera.lookAt(-2, 4.1, -12);
        }
        if (window.__shotCamera === 'infection') {
          const actor = game.actors.get(game.self);
          if (actor) { camera.position.set(actor.position.x + 6, 4.4, actor.position.z + 7); camera.lookAt(actor.position.x, 1.05, actor.position.z); }
        }
      }
      return render(scene, camera);
    };
  });
  await position(0, 22, { light: true });
  await camera('wide');
  await record('01-blackout', async () => { await wait(5500); });

  await position(-9, 25);
  zombies([[2, 6], [4, 8], [-5, -4]]);
  await camera(null); await aim(-9, 12);
  await record('02-scavenge', async () => {
    await wait(450); await page.keyboard.press('KeyF');
    await page.keyboard.down('KeyW'); await wait(1050); await page.keyboard.up('KeyW');
    await wait(250); await page.keyboard.press('KeyE'); await wait(4000);
  });

  await position(-1, 25, { light: true });
  zombies([[-2, 12], [1, 9], [4, 15], [-6, 6], [6, 3], [1, 4], [-3, -3]]);
  await aim(-2, 12);
  await record('03-combat', async () => {
    await wait(400); await page.mouse.down(); await wait(1050); await page.mouse.up();
    await aim(4, 15); await wait(150); await page.mouse.down(); await wait(1050); await page.mouse.up();
    await page.keyboard.press('KeyR'); await wait(1800);
    await aim(1, 9); await page.mouse.down(); await wait(1100); await page.mouse.up(); await wait(1000);
  });

  await position(-10, 35);
  Object.assign(room.cars[0], { x: -10, z: 35, yaw: Math.PI });
  zombies([[-10, 11], [-13, 5], [-7, -4]]);
  await wait(250); await page.keyboard.press('KeyE');
  await record('04-drive', async () => {
    await wait(300); await page.keyboard.down('KeyW'); await wait(3400); await page.keyboard.up('KeyW'); await wait(2000);
  });

  await position(0, 5.5, { batteries: 1 });
  room.power = 2;
  await camera('wide');
  await record('05-power', async () => { await wait(1300); await page.keyboard.press('KeyE'); await wait(4400); });

  await position(0, 23, { health: 60, light: true });
  for (const p of room.players.values()) if (p.bot) { p.x = -20; p.z = 50; }
  player.infection = 2.7;
  await camera('infection');
  await record('06-infection', async () => { await wait(5400); });

  const reset = createPlayer(player.id, 'SIGNAL'); Object.assign(player, reset);
  await position(0, 23, { light: true }); room.power = room.required;
  await camera('wide');
  await record('07-signal', async () => { await wait(6800); });

  await page.setViewportSize({ width: 1440, height: 1800 });
  await page.evaluate(() => { window.__captureGame.setQuality('high'); window.__captureGame.renderer.toneMappingExposure = 1.65; });
  await position(0, 17, { light: true }); room.power = 2;
  let ally = 0;
  for (const p of room.players.values()) if (p.bot) { p.x = -4 + ally++ * 3; p.z = 19 + ally; p.light = true; p.batteries = 2; }
  zombies([[-8, -5], [7, 0], [-11, 4], [10, -4]]);
  await camera('poster');
  await page.addStyleTag({ content: '#hud,#lobby,.vignette,.grain,#damage-flash{display:none!important}' });
  await wait(500);
  await page.screenshot({ path: path.join(output, 'poster-engine.png') });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await camera('wide'); await wait(450);
  await page.screenshot({ path: path.join(output, 'wide-engine.png') });
  manifest.errors = errors;
  await writeFile(path.join(output, 'capture.json'), JSON.stringify(manifest, null, 2));
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('All staged captures completed without browser errors.');
} finally { await browser.close(); await app.close(); }
