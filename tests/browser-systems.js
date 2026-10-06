import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { createGameServer } from '../server/index.js';
import { distance, WORLD } from '../shared/world.js';

const app = await createGameServer();
const { port } = await app.listen(0);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const waitFor = async predicate => { const until = Date.now() + 5000; while (!predicate()) { if (Date.now() > until) throw new Error('Fixture assertion timed out'); await new Promise(r => setTimeout(r, 50)); } };
try {
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle' });
  if (await page.locator('#how-to-play').isVisible()) { await page.locator('#how-understood').check(); await page.locator('#how-continue').click(); await page.locator('#how-to-play').waitFor({ state: 'hidden' }); }
  await page.locator('#callsign').fill('SYSTEM TESTER');
  await page.locator('#crew-size').selectOption('1'); await page.locator('#deploy').click();
  await page.locator('#hud').waitFor({ state: 'visible' });
  await page.locator('#mission-briefing').waitFor({ state: 'visible' }); await page.locator('#briefing-proceed').click(); await page.locator('#mission-briefing').waitFor({ state: 'hidden' });
  const info = await page.evaluate(() => window.__BLACKGRID__.diagnostics);
  let room = app.rooms.get(info.room), p = room.players.get(info.player);
  room.zombies = [];
  const supply = room.supplies.find(s => s.type === 'battery'); p.x = supply.x; p.z = supply.z;
  await page.waitForTimeout(250); await page.keyboard.press('KeyE'); await waitFor(() => p.batteries === 1);
  p.x = 0; p.z = 3; await page.waitForTimeout(250); await page.keyboard.press('KeyE'); await waitFor(() => room.power === 1);
  const car = room.cars[0]; p.x = car.x; p.z = car.z;
  await page.waitForTimeout(250); await page.keyboard.press('KeyE'); await waitFor(() => p.vehicle === car.id);
  const before = { x: car.x, z: car.z };
  await page.keyboard.down('KeyS'); await page.waitForTimeout(800); await page.keyboard.up('KeyS');
  assert.ok(distance(before, car) > 1);
  await page.keyboard.press('KeyE'); await waitFor(() => !p.vehicle);
  p.health = 30; p.medkits = 1;
  await page.waitForTimeout(150); await page.keyboard.press('KeyH'); await waitFor(() => p.health === 85);
  for (let stage = 0; stage < 3; stage++) {
    room.zombies = [];
    while (room.power < room.required) {
      p.batteries = 2; p.x = 0; p.z = 3;
      await page.waitForTimeout(140); await page.keyboard.press('KeyE');
      await page.waitForTimeout(140);
    }
    p.x = 0; p.z = 76; await page.waitForTimeout(180); await page.keyboard.press('KeyE');
    await waitFor(() => stage === 2 ? room.phase === 'won' : room.stage === stage + 1);
    if (stage < 2) { await page.locator('#mission-briefing').waitFor({ state: 'visible' }); await page.locator('#briefing-proceed').click(); await page.locator('#mission-briefing').waitFor({ state: 'hidden' }); }
  }
  await page.locator('#afterlight').waitFor({ state: 'visible' });
  assert.equal((await page.evaluate(() => window.__BLACKGRID__.diagnostics)).phase, 'hub');
  await page.screenshot({ path: 'artifacts/victory.png' });
  await page.locator('#enter-afterlight').click();
  await page.locator('#social-panel').waitFor({ state: 'visible' });
  await page.locator('#chat-input').fill('Hello Afterlight'); await page.locator('#chat-form button').click();
  await page.getByText('Hello Afterlight').waitFor({ state: 'visible' });
  await page.locator('#leave-afterlight').click(); await page.locator('#lobby').waitFor({ state: 'visible' });
  await page.locator('#callsign').fill('SYSTEM TESTER TWO');
  await page.locator('#deploy').click(); await page.locator('#hud').waitFor({ state: 'visible' });
  await page.locator('#mission-briefing').waitFor({ state: 'visible' }); await page.locator('#briefing-proceed').click(); await page.locator('#mission-briefing').waitFor({ state: 'hidden' });
  const defeatInfo = await page.evaluate(() => window.__BLACKGRID__.diagnostics);
  room = app.rooms.get(defeatInfo.room); p = room.players.get(defeatInfo.player); room.zombies = [];
  p.infection = 0.2;
  await waitFor(() => p.infected && room.phase === 'lost');
  await page.locator('#results').waitFor({ state: 'visible' });
  assert.match(await page.locator('#result-title').textContent(), /dark took/);
  await page.locator('#restart').click(); await waitFor(() => app.rooms.get(defeatInfo.room) !== room);
  await page.locator('#results').waitFor({ state: 'hidden' });
  await page.locator('#mission-briefing').waitFor({ state: 'visible' }); await page.locator('#briefing-proceed').click(); await page.locator('#mission-briefing').waitFor({ state: 'hidden' });
  const beforeMemory = await page.evaluate(() => window.__BLACKGRID__.diagnostics);
  await page.keyboard.press('Escape'); await page.locator('#ingame-settings').click();
  await page.locator('#quality').selectOption('low'); await page.locator('#settings-close').click();
  await page.waitForTimeout(400);
  assert.equal((await page.evaluate(() => window.__BLACKGRID__.diagnostics)).quality, 'low');
  await page.keyboard.press('Escape'); await page.locator('#leave').click(); await page.locator('#lobby').waitFor({ state: 'visible' });
  await page.locator('#hosting-open').click(); await page.locator('#hosting').waitFor({ state: 'visible' }); await page.locator('#hosting-close').click();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'PASS', tested: ['cell pickup', 'power installation', 'vehicle entry, driving and exit', 'healing', 'three-stage extraction', 'victory UI', 'restart', 'infection and defeat', 'low graphics', 'hosting guide'], diagnostics: beforeMemory }, null, 2));
} finally { await browser.close(); await app.close(); }
