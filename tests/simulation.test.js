import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, addHuman, removeHuman, acceptInput, tick, action, isIlluminated, advance, snapshot } from '../server/simulation.js';
import { WORLD, STATION, SAFE_ZONE_RADIUS, blocked, clearLine, moveBody, distance, nearestInteraction, MAX_PLAYERS } from '../shared/world.js';
import { route } from '../server/navigation.js';

function setup(size = 1) {
  const room = createRoom('TEST01', 'Test operation', size);
  const p = addHuman(room, 'human', 'Tester');
  room.zombies = [];
  action(room, p, 'briefing-done');
  return { room, p };
}
test('world objectives and supplies are reachable, not inside buildings', () => {
  for (const s of WORLD.supplies) assert.equal(blocked(s.x, s.z), false, s.id);
  for (const c of WORLD.cars) assert.equal(blocked(c.x, c.z, 1.4), false, c.id);
});
test('operation briefing blocks player movement and actions until proceeded', () => {
  const { room, p } = setup();
  p.briefingDone = false; p.briefingUntil = room.time + 8;
  p.ammo = 12;
  acceptInput(p, { x: 1, z: 0, yaw: 1 }, room.time);
  action(room, p, 'fire', 1);
  assert.equal(p.input.x, 0); assert.equal(p.ammo, 12);
  action(room, p, 'briefing-done');
  acceptInput(p, { x: 1, z: 0, yaw: 1 }, room.time);
  assert.equal(p.input.x, 1); assert.equal(p.briefingDone, true);
});
test('map markers are shared only with the viewer’s team', () => {
  const { room, p } = setup(2);
  const bot = [...room.players.values()].find(player => player.bot);
  action(room, p, 'map-mark', { x: 22, z: -18 });
  bot.infected = true;
  action(room, bot, 'map-mark', { x: -14, z: 34 });
  assert.deepEqual(snapshot(room, p.id).marker, { x: 22, z: -18, owner: p.id, name: p.name });
  assert.deepEqual(snapshot(room, bot.id).marker, { x: -14, z: 34, owner: bot.id, name: bot.name });
});
test('survivors collect ammo from drone drops while infected players cannot', () => {
  const { room, p } = setup(2);
  const bot = [...room.players.values()].find(player => player.bot);
  room.ammoDrops.push({ id: 'drone-test', x: p.x, z: p.z, active: true, expiresAt: 60 });
  assert.equal(nearestInteraction(p, room)?.kind, 'ammo-drop');
  bot.infected = true; bot.x = p.x; bot.z = p.z;
  action(room, bot, 'interact');
  assert.equal(room.ammoDrops[0].active, true);
  p.ammo = 0; p.reserve = 0;
  action(room, p, 'interact');
  assert.equal(room.ammoDrops[0].active, false); assert.equal(p.ammo, 6); assert.equal(p.reserve, 48);
});
test('movement is server bounded and nonfinite input cannot poison the simulation', () => {
  const { room, p } = setup();
  p.x = 0; p.z = 20;
  acceptInput(p, { x: 999, z: Infinity, yaw: NaN }, room.time);
  tick(room, 0.05);
  assert.ok(p.x <= 0.23);
  assert.ok(Number.isFinite(p.z) && Number.isFinite(p.yaw));
  tick(room, 0.5);
  assert.equal(p.input.x, 0);
});
test('collision prevents entering solid buildings and line of sight stops at walls', () => {
  const b = WORLD.buildings[0];
  const p = { x: b.x - b.w / 2 - 2, z: b.z };
  moveBody(p, 12, 0);
  assert.ok(p.x < b.x - b.w / 2);
  assert.equal(clearLine({ x: b.x - 20, z: b.z }, { x: b.x + 20, z: b.z }), false);
});
test('darkness prevents visual detection, flashlight and restored grid provide illumination', () => {
  const { room, p } = setup();
  p.x = 0; p.z = 30; p.light = false;
  assert.equal(isIlluminated(room, p), false);
  p.light = true;
  assert.equal(isIlluminated(room, p), true);
  p.light = false; room.power = room.required;
  assert.equal(isIlluminated(room, p), true);
});
test('station cannot accept remote deposits and proximity deposits consume inventory', () => {
  const { room, p } = setup();
  p.batteries = 2; p.x = 0; p.z = 60;
  action(room, p, 'interact');
  assert.equal(room.power, 0);
  p.z = 0;
  action(room, p, 'interact');
  assert.equal(room.power, 2);
  assert.equal(p.batteries, 0);
});
test('pickups cannot be duplicated and weapons reload from finite reserve', () => {
  const { room, p } = setup();
  const supply = room.supplies.find(s => s.type === 'battery');
  p.x = supply.x; p.z = supply.z;
  action(room, p, 'interact'); action(room, p, 'interact');
  assert.equal(p.batteries, 1);
  p.ammo = 0; p.reserve = 4;
  action(room, p, 'reload');
  tick(room, 1.3);
  assert.equal(p.ammo, 4); assert.equal(p.reserve, 0);
});
test('infection is irreversible and transformation drops objective items', () => {
  const { room, p } = setup(2);
  p.infection = 0.02; p.batteries = 2;
  tick(room, 0.05);
  assert.equal(p.infected, true); assert.equal(p.batteries, 0);
  assert.equal(room.supplies.filter(s => s.id.startsWith('drop-')).length, 2);
  action(room, p, 'heal'); assert.equal(p.infected, true);
});
test('crew fills vacancies and human joins replace bots without exceeding fifteen', () => {
  const { room } = setup(15);
  assert.equal(room.players.size, 15);
  for (let i = 1; i < 15; i++) assert.ok(addHuman(room, `p${i}`, `Player ${i}`));
  assert.equal(room.players.size, MAX_PLAYERS);
  assert.equal(addHuman(room, 'extra', 'Overflow'), null);
  removeHuman(room, 'p1');
  assert.equal(room.players.size, MAX_PLAYERS);
  assert.equal([...room.players.values()].filter(p => p.bot).length, 1);
});
test('cars support passengers and automatically promote a passenger when the driver exits', () => {
  const { room, p } = setup(2);
  const passenger = addHuman(room, 'passenger', 'Passenger');
  action(room, passenger, 'briefing-done');
  const car = room.cars[0]; p.x = car.x; p.z = car.z;
  action(room, p, 'interact');
  assert.equal(p.vehicle, car.id); assert.equal(car.driver, p.id);
  passenger.x = car.x; passenger.z = car.z;
  action(room, passenger, 'interact');
  assert.equal(passenger.vehicleSeat, 'passenger'); assert.deepEqual(car.passengers, [passenger.id]);
  action(room, p, 'interact');
  assert.equal(p.vehicle, null); assert.equal(car.driver, passenger.id); assert.equal(passenger.vehicleSeat, 'driver');
});
test('a passenger can fire from a moving vehicle while moving occupants are protected from zombie bites', () => {
  const { room, p } = setup(2);
  const passenger = addHuman(room, 'passenger', 'Passenger');
  action(room, passenger, 'briefing-done');
  const car = room.cars[0]; p.x = car.x; p.z = car.z; action(room, p, 'interact');
  passenger.x = car.x; passenger.z = car.z; action(room, passenger, 'interact');
  car.speed = 10;
  room.zombies = [{ id: 'target', x: car.x, z: car.z + 6, yaw: 0, health: 88, attackAt: 0, memory: null, memoryUntil: 0, wanderAt: 0, variant: 0, alert: false, path: null }];
  action(room, passenger, 'fire', 0);
  assert.ok(passenger.ammo < 12);
  assert.ok(room.zombies[0].health < 88, 'passenger shot should damage infected');
  const health = passenger.health; room.time = 10;
  tick(room, 0.1);
  assert.equal(passenger.health, health, 'zombies cannot damage a player while their car is moving');
});
test('campaign advances through three operations and only extraction completes it', () => {
  const { room, p } = setup();
  room.power = room.required; p.x = 0; p.z = 0;
  advance(room, p); assert.equal(room.stage, 0);
  for (let i = 0; i < 3; i++) { room.power = room.required; p.x = 0; p.z = 76; advance(room, p); }
  assert.equal(room.phase, 'won');
});
test('shots damage infected only and are limited by ammunition and fire cooldown', () => {
  const { room, p } = setup();
  p.x = 0; p.z = 20;
  const zombie = { id: 'test-z', x: 0, z: 25, health: 88, yaw: 0, attackAt: 10, variant: 0, wanderAt: 100 };
  room.zombies.push(zombie);
  acceptInput(p, { x: 0, z: 0, yaw: 0, fire: true }, room.time);
  tick(room, 0.05);
  assert.equal(p.ammo, 11); assert.equal(zombie.health, 50);
  tick(room, 0.05); assert.equal(p.ammo, 11);
});
test('killing an AI infected brings a replacement into the district instead of clearing the wave', () => {
  const { room, p } = setup();
  p.x = 0; p.z = 20; p.yaw = 0;
  const zombie = { id: 'replace-me', x: 0, z: 25, health: 20, yaw: 0, attackAt: 100, variant: 0, wanderAt: 100 };
  room.zombies = [zombie];
  action(room, p, 'fire', 0);
  tick(room, 0.05);
  assert.equal(room.totalKills, 1);
  assert.equal(room.zombies.length, 1);
  assert.notEqual(room.zombies[0].id, 'replace-me');
  assert.ok(distance(room.zombies[0], STATION) > SAFE_ZONE_RADIUS);
  assert.ok(room.events.some(event => event.type === 'reinforcements'));
});
test('a player infected by transformation reanimates after being killed by survivors', () => {
  const { room, p } = setup(2);
  p.x = 0; p.z = 20; p.yaw = 0;
  const infected = addHuman(room, 'infected-human', 'Turned');
  infected.infected = true; infected.x = 0; infected.z = 25; infected.health = 1;
  action(room, p, 'fire', 0);
  assert.equal(infected.dead, true);
  assert.equal(infected.infected, true);
  assert.ok(infected.respawnAt > room.time);
  tick(room, 8.1);
  assert.equal(infected.dead, false);
  assert.equal(infected.infected, true);
  assert.equal(infected.health, 170);
});
test('a discrete trigger press survives batched press-release inputs and cannot bypass fire rate', () => {
  const { room, p } = setup();
  p.x = 0; p.z = 20;
  action(room, p, 'fire', 0);
  acceptInput(p, { x: 0, z: 0, yaw: 0, fire: false }, room.time);
  tick(room, 0.05);
  assert.equal(p.ammo, 11);
  for (let i = 0; i < 20; i++) action(room, p, 'fire', 0);
  assert.equal(p.ammo, 11);
  assert.ok(Number.isFinite(p.yaw));
});
test('navigation finds a route around a city block', () => {
  const start = { x: -52, z: -66 }, end = { x: -80, z: -66 };
  const path = route(start, end);
  assert.ok(path.length > 2);
  assert.ok(path.every(p => !blocked(p.x, p.z)));
  assert.ok(distance(path[path.length - 1], end) < 4);
});
test('snapshots contain public state but no input, internal memory, or mutable entities', () => {
  const { room, p } = setup();
  const snap = snapshot(room);
  assert.equal(snap.players[0].input, undefined);
  snap.players[0].health = 0;
  assert.equal(p.health, 100);
  assert.doesNotThrow(() => JSON.stringify(snap));
});
test('learning stays bounded and room simulation does not share mutable state', () => {
  const { room, p } = setup();
  const other = createRoom('OTHER1', 'Other');
  p.light = true;
  room.learning.shots = 9999;
  for (let i = 0; i < 10; i++) tick(room, 0.05);
  assert.ok(room.adaptation <= 3);
  assert.equal(other.learning.shots, 0);
  assert.equal(other.time, 0);
});
test('infected learn routes only from sensed humans, never invisible stationary players', () => {
  const { room, p } = setup();
  p.x = 0; p.z = 25; p.light = false;
  const z = { id: 'observer', x: 0, z: 15, health: 88, yaw: 0, attackAt: 100, variant: 0, wanderAt: 100, wander: { x: 0, z: 15 }, memory: null };
  room.zombies = [z];
  tick(room, 0.05);
  assert.equal(z.alert, false);
  assert.equal(room.heat.reduce((sum, n) => sum + n, 0), 0);
  p.light = true;
  tick(room, 0.05);
  assert.equal(z.alert, true);
  assert.ok(room.heat.reduce((sum, n) => sum + n, 0) > 0);
});
test('the power station is a protected zone that infected cannot enter or attack inside', () => {
  const { room, p } = setup();
  p.x = STATION.x; p.z = STATION.z; p.light = true;
  const z = { id: 'safe-zone-test', x: 0, z: SAFE_ZONE_RADIUS + 1, health: 88, yaw: 0, attackAt: 0, variant: 0, wanderAt: 100, wander: { ...STATION }, memory: null };
  room.zombies = [z];
  for (let i = 0; i < 100; i++) tick(room, 0.05);
  assert.ok(distance(z, STATION) >= SAFE_ZONE_RADIUS - 0.2, `infected crossed the station perimeter: ${distance(z, STATION)}`);
  z.x = p.x; z.z = p.z + 0.5; z.attackAt = 0;
  tick(room, 0.05);
  assert.equal(p.health, 100);
  p.infected = true; p.x = 0; p.z = SAFE_ZONE_RADIUS + 0.1;
  acceptInput(p, { x: 0, z: -1, yaw: 0 }, room.time);
  for (let i = 0; i < 20; i++) tick(room, 0.05);
  assert.ok(distance(p, STATION) >= SAFE_ZONE_RADIUS - 0.2);
});
