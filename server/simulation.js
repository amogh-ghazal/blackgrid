import { WORLD, STATION, SAFE_ZONE_RADIUS, EXTRACTION, REQUIRED, WEAPONS, STAGES, MAX_PLAYERS, clamp, distance, moveBody, clearLine, blocked, randomSeed, nearestInteraction, isIlluminated } from '../shared/world.js';
export { isIlluminated } from '../shared/world.js';
import { navigate } from './navigation.js';

const BOT_NAMES = ['MARA', 'ROOK', 'ISHAN', 'VALE', 'ECHO', 'NOVA', 'SABLE', 'ATLAS', 'JUNO', 'KADE', 'SOL', 'REMY', 'FINCH', 'ASH'];
function moveOutsideStation(body, dx, dz, radius = 0.55) {
  const x = body.x, z = body.z, before = distance(body, STATION);
  moveBody(body, dx, dz, radius);
  const after = distance(body, STATION);
  if ((before >= SAFE_ZONE_RADIUS + radius && after < SAFE_ZONE_RADIUS + radius) || (before < SAFE_ZONE_RADIUS + radius && after < before)) { body.x = x; body.z = z; }
}
const cleanInput = () => ({ x: 0, z: 0, yaw: 0, sprint: false, fire: false });
export function createPlayer(id, name, bot = false) {
  return { id, name, bot, x: (Math.random() - 0.5) * 7, z: 16 + Math.random() * 5, yaw: Math.PI, health: 100, stamina: 100, weapon: 'pistol', ammo: 12, reserve: 60, batteries: 0, medkits: 1, light: false, infected: false, infection: 0, dead: false, kills: 0, delivered: 0, vehicle: null, vehicleSeat: null, input: cleanInput(), lastInput: 0, fireAt: 0, reloadAt: 0, protection: 5, attackAt: 0, respawnAt: 0, moved: false };
}
export function createRoom(code, title, targetSize = 5, memory = {}, social = false) {
  const room = { code, title, targetSize: clamp(targetSize, 1, MAX_PLAYERS), owner: null, stage: 0, phase: social ? 'hub' : 'active', social, power: 0, required: REQUIRED[0], time: 0, elapsed: 0, players: new Map(), zombies: [], pendingReinforcements: 0, cars: WORLD.cars.map(c => ({ ...c, driver: null, passengers: [], speed: 0, headlights: false })), supplies: social ? [] : WORLD.supplies.map(s => ({ ...s })), events: [], noises: [], blood: [], heat: new Float32Array(36), learning: { shots: clamp(Number(memory.shots) || 0, 0, 10000), lights: clamp(Number(memory.lights) || 0, 0, 10000), escapes: clamp(Number(memory.escapes) || 0, 0, 10000) }, adaptation: 0, totalKills: 0, waveAt: 110, eventId: 0, rng: randomSeed(721), created: Date.now(), lastActive: Date.now(), stageSince: 0 };
  if (!social) spawnWave(room, 12);
  return room;
}
export const createSocialRoom = (code, memory = {}) => createRoom(code, 'AFTERLIGHT / SOCIAL LOUNGE', MAX_PLAYERS, memory, true);
export function emit(room, type, data = {}) {
  room.events.push({ id: ++room.eventId, type, t: room.time, ...data });
  if (room.events.length > 80) room.events.shift();
}
export function addHuman(room, id, name) {
  if ([...room.players.values()].filter(p => !p.bot).length >= MAX_PLAYERS) return null;
  const bot = [...room.players.values()].find(p => p.bot);
  const player = createPlayer(id, name);
  if (bot && room.players.size >= room.targetSize) {
    Object.assign(player, { x: bot.x, z: bot.z, health: bot.health, weapon: bot.weapon, ammo: bot.ammo, reserve: bot.reserve, batteries: bot.batteries, infection: bot.infection, infected: bot.infected, dead: bot.dead, respawnAt: bot.respawnAt });
    room.players.delete(bot.id);
  }
  player.protection = room.time + 5;
  room.players.set(id, player);
  if (!room.owner) room.owner = id;
  if (!room.social) replenishBots(room);
  emit(room, 'join', { text: `${name} joined the operation.` });
  return player;
}
export function removeHuman(room, id) {
  const p = room.players.get(id);
  if (!p) return;
  if (p.vehicle) { const car = room.cars.find(c => c.id === p.vehicle); if (car) { if (car.driver === p.id) { car.driver = (car.passengers || []).shift() || null; const promoted = room.players.get(car.driver); if (promoted) promoted.vehicleSeat = 'driver'; if (!car.driver) { car.speed = 0; car.headlights = false; } } else car.passengers = (car.passengers || []).filter(id => id !== p.id); } }
  dropCells(room, p);
  room.players.delete(id);
  if (room.owner === id) room.owner = [...room.players.values()].find(p => !p.bot)?.id ?? null;
  replenishBots(room);
}
export function replenishBots(room) {
  let i = 0;
  while (room.players.size < room.targetSize && i < 30) {
    const id = `bot${i++}`;
    if (room.players.has(id)) continue;
    const p = createPlayer(id, BOT_NAMES[(i - 1) % BOT_NAMES.length], true);
    p.light = i % 3 === 0;
    p.protection = room.time + 6;
    room.players.set(id, p);
  }
}
export function acceptInput(player, input, time) {
  if (!input || typeof input !== 'object') return;
  player.input = { x: Number.isFinite(input.x) ? clamp(input.x, -1, 1) : 0, z: Number.isFinite(input.z) ? clamp(input.z, -1, 1) : 0, yaw: Number.isFinite(input.yaw) ? input.yaw % (Math.PI * 2) : player.yaw, sprint: input.sprint === true, fire: input.fire === true };
  player.lastInput = time;
}
function dropCells(room, p) {
  for (let i = 0; i < p.batteries; i++) room.supplies.push({ id: `drop-${p.id}-${room.eventId}-${i}`, x: p.x, z: p.z, type: 'battery', active: true });
  p.batteries = 0;
}
export function action(room, p, kind, yaw) {
  if (!p || room.phase !== 'active' || p.dead) return;
  if (kind === 'fire') { if (Number.isFinite(yaw)) p.yaw = yaw % (Math.PI * 2); shoot(room, p); return; }
  if (kind === 'light' && !p.infected) { p.light = !p.light; return; }
  if (kind === 'reload' && !p.infected && !p.reloadAt && p.ammo < WEAPONS[p.weapon].magazine && p.reserve > 0) { p.reloadAt = room.time + WEAPONS[p.weapon].reload; return; }
  if (kind === 'heal' && !p.infected && p.medkits > 0 && p.health < 100) { p.health = Math.min(100, p.health + 55); p.medkits--; emit(room, 'heal', { player: p.id, text: `${p.name} used a trauma kit. Infection cannot be cured.` }); return; }
  if (kind !== 'interact') return;
  const interaction = nearestInteraction(p, room);
  if (!interaction) return;
  if (interaction.kind === 'exit') { exitVehicle(room, p); return; }
  if (interaction.kind === 'enter') {
    const car = room.cars.find(c => c.id === interaction.id);
    if (!car.driver) { car.driver = p.id; p.vehicleSeat = 'driver'; car.headlights = true; emit(room, 'engine', { x: car.x, z: car.z }); }
    else { car.passengers ||= []; if (car.passengers.length >= 3) return; car.passengers.push(p.id); p.vehicleSeat = 'passenger'; }
    p.vehicle = car.id; p.x = car.x; p.z = car.z;
  }
  if (interaction.kind === 'pickup') {
    const s = room.supplies.find(s => s.id === interaction.id);
    s.active = false;
    if (s.type === 'battery') p.batteries++;
    else if (s.type === 'ammo') p.reserve = Math.min(240, p.reserve + 48);
    else if (s.type === 'medkit') p.medkits = Math.min(5, p.medkits + 1);
    else { p.weapon = s.type; p.ammo = WEAPONS[s.type].magazine; p.reserve = Math.min(240, p.reserve + 36); p.reloadAt = 0; }
    emit(room, 'pickup', { player: p.id, item: s.type, x: s.x, z: s.z });
  }
  if (interaction.kind === 'deliver') {
    const amount = Math.min(p.batteries, room.required - room.power);
    room.power += amount; p.batteries -= amount; p.delivered += amount;
    emit(room, 'power', { text: `${p.name} installed ${amount} power cell${amount > 1 ? 's' : ''}.`, x: 0, z: 0 });
    room.noises.push({ x: 0, z: 0, radius: 90, until: room.time + 12 });
    if (room.power >= room.required) { emit(room, 'objective', { text: 'GRID ONLINE. Reach the south evacuation zone.' }); spawnWave(room, 4 + room.stage * 2); }
  }
  if (interaction.kind === 'extract') advance(room, p);
}
function exitVehicle(room, p) {
  const car = room.cars.find(c => c.id === p.vehicle);
  if (!car) { p.vehicle = null; return; }
  for (const [dx, dz] of [[3, 0], [-3, 0], [0, 3], [0, -3]]) {
    if (!blocked(car.x + dx, car.z + dz)) { p.x = car.x + dx; p.z = car.z + dz; p.vehicle = null; p.vehicleSeat = null; if (car.driver === p.id) { car.driver = (car.passengers || []).shift() || null; const promoted = room.players.get(car.driver); if (promoted) promoted.vehicleSeat = 'driver'; if (!car.driver) { car.speed = 0; car.headlights = false; } } else car.passengers = (car.passengers || []).filter(id => id !== p.id); return; }
  }
}
export function advance(room, p) {
  if (room.phase !== 'active' || room.power < room.required || p.infected || p.dead || distance(p, EXTRACTION) >= 8) return;
  room.learning.escapes = Math.min(10000, room.learning.escapes + 1);
  if (room.stage === 2) { room.phase = 'won'; emit(room, 'victory', { text: 'SIGNAL RESTORED. Your crew made it through the blackout.' }); return; }
  room.stage++;
  room.required = REQUIRED[room.stage]; room.power = 0; room.stageSince = room.time;
  room.supplies = WORLD.supplies.map(s => ({ ...s }));
  room.cars = WORLD.cars.map(c => ({ ...c, driver: null, passengers: [], speed: 0, headlights: false }));
  room.zombies = []; room.noises = []; room.blood = [];
  for (const player of room.players.values()) { player.vehicle = null; player.vehicleSeat = null; player.batteries = 0; player.x = (room.rng() - 0.5) * 9; player.z = player.infected ? -75 : 16 + room.rng() * 5; player.protection = room.time + 12; player.path = null; }
  room.waveAt = room.time + 110;
  spawnWave(room, 12 + room.stage * 4);
  emit(room, 'stage', { text: `OPERATION ${room.stage + 1}: ${STAGES[room.stage]}. Restore the next district.` });
}
export function spawnWave(room, count) {
  for (let i = 0; i < count && room.zombies.length < 64; i++) {
    let x, z;
    for (let attempt = 0; attempt < 100; attempt++) {
      x = (room.rng() - 0.5) * 160; z = (room.rng() - 0.5) * 160;
      if (!blocked(x, z) && distance({ x, z }, STATION) > SAFE_ZONE_RADIUS + 4 && Math.hypot(x, z - 16) > 28 && [...room.players.values()].every(p => distance({ x, z }, p) > 16)) break;
    }
    if (blocked(x, z) || distance({ x, z }, STATION) <= SAFE_ZONE_RADIUS + 4) continue;
    room.zombies.push({ id: `z${++room.eventId}`, x, z, yaw: room.rng() * Math.PI * 2, health: 88 + room.stage * 10, attackAt: 0, memory: null, memoryUntil: 0, wanderAt: 0, variant: Math.floor(room.rng() * 3), alert: false, path: null });
  }
}
function turn(room, p) {
  if (p.infected) return;
  if (p.vehicle) exitVehicle(room, p);
  dropCells(room, p);
  p.infected = true; p.infection = 0; p.health = 170; p.light = false; p.dead = false; p.reloadAt = 0; p.path = null;
  if (distance(p, STATION) < SAFE_ZONE_RADIUS + 0.6) { p.x = STATION.x; p.z = STATION.z + SAFE_ZONE_RADIUS + 3; }
  emit(room, 'turn', { player: p.id, text: `${p.name} has turned. Keep your distance.` });
}
function hurt(room, p, amount, bite = false) {
    const vehicle = p.vehicle && room.cars.find(car => car.id === p.vehicle);
    if (p.dead || room.time < p.protection || (!p.infected && vehicle?.speed > 1) || !p.infected && distance(p, STATION) < SAFE_ZONE_RADIUS + 0.6) return;
  p.health -= amount;
  emit(room, 'hit', { player: p.id, x: p.x, z: p.z });
  if (bite && !p.infected && !p.infection && !p.vehicle) { p.infection = 75; emit(room, 'bite', { player: p.id, text: `${p.name} was bitten. Transformation in 75 seconds.` }); }
  if (p.health <= 0) {
    if (!p.infected) turn(room, p);
    else { p.health = 0; p.dead = true; p.respawnAt = room.time + 8; }
  }
}
function shoot(room, p) {
  if (room.time < p.fireAt || p.reloadAt || (p.vehicle && p.vehicleSeat !== 'passenger') || p.dead) return;
  if (p.infected) {
    if (distance(p, STATION) < SAFE_ZONE_RADIUS + 0.6) return;
    p.fireAt = room.time + 0.85;
    emit(room, 'swipe', { x: p.x, z: p.z });
    for (const target of room.players.values()) if (!target.infected && !target.dead && distance(target, STATION) >= SAFE_ZONE_RADIUS && distance(p, target) < 2.5 && clearLine(p, target)) hurt(room, target, 18, true);
    return;
  }
  const w = WEAPONS[p.weapon];
  if (p.ammo <= 0) { action(room, p, 'reload'); return; }
  p.ammo--; p.fireAt = room.time + w.interval;
  room.noises.push({ x: p.x, z: p.z, radius: p.weapon === 'pistol' ? 32 : 55, until: room.time + 2 });
  if (!p.bot) room.learning.shots = Math.min(10000, room.learning.shots + 1);
  const targets = [...room.zombies, ...[...room.players.values()].filter(t => t.infected && !t.dead)];
  let end = { x: p.x + Math.sin(p.yaw) * w.range, z: p.z + Math.cos(p.yaw) * w.range };
  for (let shot = 0; shot < (w.pellets || 1); shot++) {
    const yaw = p.yaw + (room.rng() - 0.5) * w.spread;
    const dx = Math.sin(yaw), dz = Math.cos(yaw);
    let nearest = null, near = w.range;
    for (const t of targets) {
      if (t.health <= 0) continue;
      const along = (t.x - p.x) * dx + (t.z - p.z) * dz;
      const side = Math.abs((t.x - p.x) * dz - (t.z - p.z) * dx);
      if (along > 0 && along < near && side < 0.85 && clearLine(p, t)) { nearest = t; near = along; }
    }
    if (nearest) {
      nearest.health -= w.damage;
      end = { x: nearest.x, z: nearest.z };
      emit(room, 'impact', { x: nearest.x, z: nearest.z, player: p.id });
      if (nearest.health <= 0) {
        p.kills++; room.totalKills++;
        if ('infected' in nearest) { nearest.health = 0; nearest.dead = true; nearest.respawnAt = room.time + 8; }
        else room.pendingReinforcements++;
        emit(room, 'kill', { x: nearest.x, z: nearest.z, player: p.id });
      }
    }
  }
  for (let t = 1; t < w.range; t += 1) {
    const sample = { x: p.x + Math.sin(p.yaw) * t, z: p.z + Math.cos(p.yaw) * t };
    if (blocked(sample.x, sample.z, 0)) { if (distance(p, sample) < distance(p, end)) end = sample; break; }
  }
  emit(room, 'shot', { player: p.id, x: p.x, z: p.z, ex: end.x, ez: end.z, weapon: p.weapon });
}
function botThink(room, p, dt) {
  if (p.infected) {
    const target = [...room.players.values()].filter(t => !t.infected && !t.dead && distance(t, STATION) >= SAFE_ZONE_RADIUS && (isIlluminated(room, t) || t.moved && distance(p, t) < 10)).sort((a, b) => distance(a, p) - distance(b, p))[0];
    if (target) { navigate(p, target, dt, 3.1, moveOutsideStation, room.time); if (distance(p, target) < 2.3) shoot(room, p); }
    return;
  }
  const threats = [...room.zombies, ...[...room.players.values()].filter(t => t.infected && !t.dead)];
  const enemy = threats.filter(z => z.health > 0 && distance(p, z) < 19 && clearLine(p, z)).sort((a, b) => distance(p, a) - distance(p, b))[0];
  if (enemy) {
    p.yaw = Math.atan2(enemy.x - p.x, enemy.z - p.z);
    shoot(room, p);
    if (distance(p, enemy) < 5) { const d = Math.max(0.1, distance(p, enemy)); moveBody(p, (p.x - enemy.x) / d * 3.4 * dt, (p.z - enemy.z) / d * 3.4 * dt); return; }
  }
  if (p.health < 50) action(room, p, 'heal');
  if (!p.ammo) action(room, p, 'reload');
  let target;
  if (room.power >= room.required) target = EXTRACTION;
  else if (p.batteries > 0) target = STATION;
  else {
    const humans = [...room.players.values()].filter(h => !h.bot && !h.infected && !h.dead);
    const human = humans[0];
    const supplies = room.supplies.filter(s => s.active && (s.type === 'battery' || p.reserve < 15 && s.type === 'ammo'));
    supplies.sort((a, b) => distance(a, p) - distance(b, p));
    target = supplies[Number(p.id.replace('bot', '')) % Math.min(3, supplies.length)] ?? human ?? STATION;
  }
  if (target) {
    const before = { x: p.x, z: p.z };
    const yaw = p.yaw;
    navigate(p, target, dt, p.batteries ? 3.1 : 3.8, moveBody, room.time);
    p.moved = distance(before, p) > 0.01;
    if (enemy) p.yaw = yaw;
    if (distance(p, target) < 2.5 && target !== EXTRACTION) action(room, p, 'interact');
  }
}
function zombieThink(room, z, dt) {
  let target = null, score = -Infinity;
  for (const p of room.players.values()) {
    if (p.infected || p.dead) continue;
    const d = distance(z, p);
    if (distance(p, STATION) < SAFE_ZONE_RADIUS) continue;
    const visible = d < 29 && isIlluminated(room, p) && clearLine(z, p);
    const audible = p.moved && d < (p.vehicle ? 35 : p.input.sprint ? 13 : 6);
    const smell = p.health < 60 && d < 4;
    if (visible || audible || smell) {
      if (-d > score) { target = { x: p.x, z: p.z }; score = -d; }
      if (!p.bot) {
        const index = clamp(Math.floor((p.z + 90) / 30), 0, 5) * 6 + clamp(Math.floor((p.x + 90) / 30), 0, 5);
        room.heat[index] = Math.min(100, room.heat[index] + dt);
      }
    }
    const car = p.vehicle && room.cars.find(c => c.id === p.vehicle);
    if (distance(p, STATION) >= SAFE_ZONE_RADIUS && !(car?.speed > 1) && d < (p.vehicle ? 2.6 : 1.55) && clearLine(z, p) && room.time > z.attackAt) { hurt(room, p, p.vehicle ? 4 : 8, !p.vehicle); z.attackAt = room.time + 1.8; }
  }
  if (!target) {
    const noise = room.noises.filter(n => distance(z, n) < n.radius).sort((a, b) => b.until - a.until)[0];
    if (noise) target = { x: noise.x, z: noise.z };
  }
  if (!target && room.power > 0 && distance(z, STATION) < 18 + room.power * 6 && clearLine(z, STATION)) target = { x: STATION.x + Math.sign(z.x || 1) * (SAFE_ZONE_RADIUS + 5), z: STATION.z + Math.sign(z.z || 1) * (SAFE_ZONE_RADIUS + 5) };
  if (!target) {
    const blood = room.blood.find(b => distance(z, b) < 5);
    if (blood) target = blood;
  }
  if (target) {
    z.memory = { ...target }; z.memoryUntil = room.time + 3 + room.adaptation * 1.5;
    if (room.adaptation >= 2 && z.variant === 2 && distance(z, target) > 7) {
      const angle = Math.atan2(z.x - target.x, z.z - target.z) + 0.6;
      const flank = { x: target.x + Math.sin(angle) * 4, z: target.z + Math.cos(angle) * 4 };
      if (!blocked(flank.x, flank.z)) target = flank;
    }
  } else if (z.memory && room.time < z.memoryUntil) target = z.memory;
  z.alert = Boolean(target);
  if (!target) {
    if (!z.wander || room.time > z.wanderAt || distance(z, z.wander) < 2) {
      z.wanderAt = room.time + 10 + room.rng() * 12;
      if (room.adaptation >= 1 && Math.max(...room.heat) > 0 && room.rng() < 0.35) {
        const hot = room.heat.indexOf(Math.max(...room.heat));
        z.wander = { x: (hot % 6) * 30 - 75, z: Math.floor(hot / 6) * 30 - 75 };
      } else z.wander = { x: clamp(z.x + (room.rng() - 0.5) * 25, -80, 80), z: clamp(z.z + (room.rng() - 0.5) * 25, -80, 80) };
    }
    target = z.wander;
  }
  navigate(z, target, dt, z.alert ? 2.3 + room.stage * 0.18 + room.adaptation * 0.13 : 0.8, moveOutsideStation, room.time);
}
export function tick(room, dt) {
  if (room.social && room.phase === 'hub') {
    room.time += dt;
    for (const p of room.players.values()) {
      if (p.bot) continue;
      if (room.time - p.lastInput > 0.4) p.input = cleanInput();
      p.yaw = p.input.yaw;
      const length = Math.hypot(p.input.x, p.input.z);
      if (length > 0.01) {
        const before = { x: p.x, z: p.z }, speed = p.input.sprint ? 7 : 5.2;
        moveBody(p, p.input.x / Math.max(1, length) * speed * dt, p.input.z / Math.max(1, length) * speed * dt);
        p.x = clamp(p.x, -27, 27); p.z = clamp(p.z, -27, 27); p.moved = distance(before, p) > 0.01;
      }
    }
    return;
  }
  if (room.phase !== 'active') return;
  room.time += dt; room.elapsed += dt;
  room.noises = room.noises.filter(n => n.until > room.time).slice(-50);
  room.blood = room.blood.filter(b => b.until > room.time).slice(-50);
  const level = Math.min(3, Math.floor((room.learning.shots * 0.08 + room.learning.lights * 0.015 + room.elapsed * 0.04 + room.learning.escapes * 8) / 14));
  if (level > room.adaptation) { room.adaptation = level; emit(room, 'evolution', { text: ['','INFECTED ADAPTING: investigating familiar routes.','INFECTED ADAPTING: coordinated flanking observed.','INFECTED ADAPTING: longer pursuit memory.'][level] }); }
  for (const p of room.players.values()) {
    if (p.dead) { if (room.time >= p.respawnAt) { p.dead = false; p.health = 170; p.x = 0; p.z = -76; p.protection = room.time + 3; } else continue; }
    if (p.infection > 0) { p.infection = Math.max(0, p.infection - dt); if (!p.infection) turn(room, p); }
    if (p.reloadAt && room.time >= p.reloadAt) { const amount = Math.min(WEAPONS[p.weapon].magazine - p.ammo, p.reserve); p.ammo += amount; p.reserve -= amount; p.reloadAt = 0; }
    p.moved = false;
    if (p.bot) botThink(room, p, dt);
    else {
      if (room.time - p.lastInput > 0.4) p.input = cleanInput();
      p.yaw = p.input.yaw;
      const length = Math.hypot(p.input.x, p.input.z);
      if (p.vehicle) {
        const car = room.cars.find(c => c.id === p.vehicle);
        if (car) {
          if (p.vehicleSeat === 'passenger') { p.x = car.x; p.z = car.z; p.yaw = p.input.yaw; p.moved = car.speed > 1; if (p.input.fire) shoot(room, p); continue; }
          if (length > 0.1) { const desired = Math.atan2(p.input.x, p.input.z); let delta = Math.atan2(Math.sin(desired - car.yaw), Math.cos(desired - car.yaw)); car.yaw += clamp(delta, -dt * 2.8, dt * 2.8); car.speed = Math.min(17, car.speed + dt * 8); } else car.speed = Math.max(0, car.speed - dt * 15);
          const before = { x: car.x, z: car.z };
          moveBody(car, Math.sin(car.yaw) * car.speed * dt, Math.cos(car.yaw) * car.speed * dt, 1.4);
          if (distance(before, car) < car.speed * dt * 0.3) car.speed *= 0.6;
          p.x = car.x; p.z = car.z; p.yaw = car.yaw; p.moved = car.speed > 1;
          if (car.speed > 5) for (const z of room.zombies) if (z.health > 0 && distance(car, z) < 2.5) { z.health = 0; p.kills++; room.totalKills++; room.pendingReinforcements++; emit(room, 'kill', { x: z.x, z: z.z, player: p.id }); }
        }
      } else if (length > 0.01) {
        const sprint = p.input.sprint && p.stamina > 3 && !p.infected;
        const speed = p.infected ? 4.8 : (sprint ? 7 : 4.5) * (p.batteries ? 0.86 : 1);
        const before = { x: p.x, z: p.z };
        const move = p.infected ? moveOutsideStation : moveBody;
        move(p, p.input.x / Math.max(1, length) * speed * dt, p.input.z / Math.max(1, length) * speed * dt);
        p.moved = distance(before, p) > 0.01;
        if (sprint) p.stamina = Math.max(0, p.stamina - 20 * dt);
      }
      if (!p.input.sprint || !length) p.stamina = Math.min(100, p.stamina + 16 * dt);
      if (p.input.fire) shoot(room, p);
      if (p.light) room.learning.lights = Math.min(10000, room.learning.lights + dt);
    }
    if (p.health < 65 && !p.infected && Math.floor(room.time * 2) !== Math.floor((room.time - dt) * 2)) room.blood.push({ x: p.x, z: p.z, until: room.time + 8 });
  }
  for (const car of room.cars) for (const id of car.passengers || []) { const passenger = room.players.get(id); if (passenger && !passenger.dead) { passenger.x = car.x; passenger.z = car.z; passenger.moved = car.speed > 1; } }
  for (const z of room.zombies) if (z.health > 0) zombieThink(room, z, dt);
  room.zombies = room.zombies.filter(z => z.health > 0);
  if (room.pendingReinforcements > 0) {
    const count = room.pendingReinforcements; room.pendingReinforcements = 0;
    spawnWave(room, count);
    emit(room, 'reinforcements', { text: 'The noise drew more infected into the district.' });
  }
  if (room.time > room.waveAt) { spawnWave(room, 4 + room.stage); room.waveAt = room.time + 110; }
  if (room.players.size && ![...room.players.values()].some(p => !p.infected && !p.dead)) { room.phase = 'lost'; emit(room, 'defeat', { text: 'THE SIGNAL WENT DARK. No survivors remain.' }); }
}
const round = n => Math.round(n * 100) / 100;
export function snapshot(room) {
  return { code: room.code, title: room.title, owner: room.owner, stage: room.stage, phase: room.phase, power: room.power, required: room.required, time: round(room.time), adaptation: room.adaptation, totalKills: room.totalKills,
    players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, bot: p.bot, x: round(p.x), z: round(p.z), yaw: round(p.yaw), health: round(p.health), stamina: round(p.stamina), weapon: p.weapon, ammo: p.ammo, reserve: p.reserve, batteries: p.batteries, medkits: p.medkits, light: p.light, infected: p.infected, infection: round(p.infection), dead: p.dead, kills: p.kills, delivered: p.delivered, vehicle: p.vehicle, vehicleSeat: p.vehicleSeat, reloadAt: p.reloadAt, moved: p.moved, respawnAt: p.respawnAt })),
    zombies: room.zombies.map(z => ({ id: z.id, x: round(z.x), z: round(z.z), yaw: round(z.yaw), health: z.health, variant: z.variant, alert: z.alert })),
    cars: room.cars.map(c => ({ id: c.id, x: round(c.x), z: round(c.z), yaw: round(c.yaw), color: c.color, driver: c.driver, passengers: c.passengers || [], speed: round(c.speed), headlights: c.headlights })),
    supplies: room.supplies.filter(s => s.active).map(s => ({ ...s })), events: room.events.slice(-30) };
}
