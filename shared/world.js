export const WORLD_SIZE = 180;
export const LIMIT = WORLD_SIZE / 2 - 3;
export const MAX_PLAYERS = 15;
export const TICK_RATE = 20;
export const STATION = { x: 0, z: 0 };
export const SAFE_ZONE_RADIUS = 17;
export const EXTRACTION = { x: 0, z: 76 };
export const STAGES = ['COLD START', 'THE RELAY', 'LAST LIGHT'];
export const REQUIRED = [2, 2, 3];
export const WEAPONS = {
  pistol: { name: 'P12 SIDEARM', damage: 38, range: 38, interval: 0.32, magazine: 12, reload: 1.25, spread: 0.015 },
  rifle: { name: 'AR-4 CARBINE', damage: 30, range: 56, interval: 0.13, magazine: 30, reload: 1.65, spread: 0.024 },
  shotgun: { name: 'M8 BREACHER', damage: 22, range: 19, interval: 0.8, magazine: 6, reload: 1.8, spread: 0.16, pellets: 6 }
};
export function randomSeed(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
export const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
export function makeWorld() {
  const rng = randomSeed(74021);
  const buildings = [];
  let id = 0;
  for (const x of [-66, -38, 38, 66]) {
    for (const z of [-66, -38, -10, 18, 46, 74]) {
      buildings.push({ id: id++, x: x + (rng() - 0.5) * 2, z, w: 15 + rng() * 5, d: 15 + rng() * 4, h: 8 + rng() * 25, variant: Math.floor(rng() * 4) });
    }
  }
  const obstacles = buildings.map(b => ({ x: b.x, z: b.z, w: b.w, d: b.d }));
  const cars = [
    { id: 'v0', x: -10, z: 14, yaw: 0, color: 0x998768 },
    { id: 'v1', x: 11, z: -26, yaw: Math.PI, color: 0x425b55 },
    { id: 'v2', x: -22, z: -57, yaw: 0.3, color: 0x914b39 },
    { id: 'v3', x: 22, z: 55, yaw: -0.5, color: 0x485675 },
    { id: 'v4', x: -51, z: 32, yaw: Math.PI / 2, color: 0x88897e },
    { id: 'v5', x: 52, z: -25, yaw: Math.PI / 2, color: 0x6c6556 }
  ];
  const supplies = [
    [-9, 19, 'battery'], [18, 29, 'battery'], [-21, -25, 'battery'],
    [23, -52, 'battery'], [-51, 5, 'battery'], [51, 32, 'battery'],
    [0, -70, 'battery'], [-20, 61, 'battery'], [53, -55, 'battery'],
    [-51, -51, 'battery'], [23, 74, 'battery'], [-75, 32, 'battery'],
    [6, 12, 'ammo'], [-7, 9, 'medkit'], [10, 19, 'rifle'],
    [-18, 32, 'ammo'], [19, -12, 'shotgun'], [-22, -12, 'medkit'],
    [51, 4, 'ammo'], [-51, 60, 'ammo'], [0, 44, 'medkit'],
    [20, 58, 'rifle'], [0, -42, 'ammo'], [-52, -25, 'shotgun']
  ].map(([x, z, type], i) => ({ id: `s${i}`, x, z, type, active: true }));
  return { buildings, obstacles, cars, supplies };
}
export const WORLD = makeWorld();
export function blocked(x, z, radius = 0.55) {
  if (Math.abs(x) > LIMIT - radius || Math.abs(z) > LIMIT - radius) return true;
  return WORLD.obstacles.some(b => Math.abs(x - b.x) < b.w / 2 + radius && Math.abs(z - b.z) < b.d / 2 + radius);
}
export function moveBody(body, dx, dz, radius = 0.55) {
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.5));
  for (let i = 0; i < steps; i++) {
    if (!blocked(body.x + dx / steps, body.z, radius)) body.x += dx / steps;
    if (!blocked(body.x, body.z + dz / steps, radius)) body.z += dz / steps;
  }
}
export function clearLine(a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  for (const box of WORLD.obstacles) {
    let lo = 0, hi = 1;
    for (const [origin, delta, min, max] of [[a.x, dx, box.x - box.w / 2, box.x + box.w / 2], [a.z, dz, box.z - box.d / 2, box.z + box.d / 2]]) {
      if (Math.abs(delta) < 0.00001) {
        if (origin < min || origin > max) { hi = -1; break; }
      } else {
        let t0 = (min - origin) / delta, t1 = (max - origin) / delta;
        if (t0 > t1) [t0, t1] = [t1, t0];
        lo = Math.max(lo, t0);
        hi = Math.min(hi, t1);
      }
    }
    if (lo <= hi) return false;
  }
  return true;
}
export function isIlluminated(room, p) {
  if (p.light || p.vehicle) return true;
  if (room.power > 0 && distance(p, STATION) < 13 + room.power * 2) return true;
  if (room.power >= room.required && Math.abs(p.x) < 14 && p.z > -65 && p.z < 78) return true;
  for (const source of room.players.values()) {
    if (!source.light || source.dead || source.infected) continue;
    const d = distance(source, p);
    if (d > 22 || !clearLine(source, p)) continue;
    const dot = ((p.x - source.x) * Math.sin(source.yaw) + (p.z - source.z) * Math.cos(source.yaw)) / Math.max(0.01, d);
    if (dot > 0.82) return true;
  }
  return false;
}
export function nearestInteraction(player, state) {
  if (player.infected || player.dead || state.phase !== 'active') return null;
  if (player.vehicle) return { kind: 'exit', label: 'Exit vehicle' };
  if (distance(player, STATION) < 7 && player.batteries > 0 && state.power < state.required) return { kind: 'deliver', label: `Install ${player.batteries} power cell${player.batteries > 1 ? 's' : ''}` };
  if (state.power >= state.required && distance(player, EXTRACTION) < 8) return { kind: 'extract', label: state.stage < 2 ? 'Deploy to next operation' : 'Evacuate the city' };
  const supply = state.supplies.filter(s => s.active && (s.type !== 'battery' || player.batteries < 2)).sort((a, b) => distance(a, player) - distance(b, player))[0];
  if (supply && distance(supply, player) < 2.8) return { kind: 'pickup', id: supply.id, label: `Collect ${supply.type === 'battery' ? 'power cell' : supply.type}` };
  const car = state.cars.find(c => !c.driver && distance(c, player) < 3.6);
  if (car) return { kind: 'enter', id: car.id, label: 'Drive vehicle' };
  return null;
}
