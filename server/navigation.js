import { WORLD_SIZE, blocked, clearLine, distance } from '../shared/world.js';

const CELL = 3;
const N = WORLD_SIZE / CELL;
const point = i => ({ x: (i % N + 0.5) * CELL - WORLD_SIZE / 2, z: (Math.floor(i / N) + 0.5) * CELL - WORLD_SIZE / 2 });
const index = p => Math.max(0, Math.min(N - 1, Math.floor((p.z + WORLD_SIZE / 2) / CELL))) * N + Math.max(0, Math.min(N - 1, Math.floor((p.x + WORLD_SIZE / 2) / CELL)));
const walkable = Array.from({ length: N * N }, (_, i) => { const p = point(i); return !blocked(p.x, p.z, 0.8); });

export function route(start, end) {
  if (clearLine(start, end)) return [end];
  const source = index(start), target = index(end);
  const costs = new Float32Array(N * N).fill(Infinity);
  const previous = new Int32Array(N * N).fill(-1);
  const closed = new Uint8Array(N * N);
  const open = [source];
  costs[source] = 0;
  let best = source, bestDistance = distance(point(source), end);
  for (let count = 0; open.length && count < 1200; count++) {
    let at = 0, score = Infinity;
    for (let j = 0; j < open.length; j++) {
      const s = costs[open[j]] + distance(point(open[j]), end);
      if (s < score) { score = s; at = j; }
    }
    const current = open[at];
    open[at] = open[open.length - 1];
    open.pop();
    if (closed[current]) continue;
    closed[current] = 1;
    const d = distance(point(current), end);
    if (d < bestDistance) { bestDistance = d; best = current; }
    if (current === target || d < 3) { best = current; break; }
    const x = current % N, z = Math.floor(current / N);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const nx = x + dx, nz = z + dz, next = nz * N + nx;
      if (nx < 0 || nz < 0 || nx >= N || nz >= N || !walkable[next] || closed[next]) continue;
      if (dx && dz && (!walkable[z * N + nx] || !walkable[nz * N + x])) continue;
      const nextCost = costs[current] + Math.hypot(dx, dz) * CELL;
      if (nextCost < costs[next]) { costs[next] = nextCost; previous[next] = current; open.push(next); }
    }
  }
  const result = [];
  for (let i = best; i !== source && i !== -1; i = previous[i]) result.push(point(i));
  result.reverse();
  if (best === target && !blocked(end.x, end.z)) result.push(end);
  return result;
}

export function navigate(body, target, dt, speed, move, now) {
  if (!body.path || now > body.repath || distance(target, body.destination ?? target) > 5) {
    body.path = route(body, target);
    body.destination = { x: target.x, z: target.z };
    body.repath = now + 1.3;
  }
  while (body.path.length && distance(body, body.path[0]) < 0.8) body.path.shift();
  const p = body.path[0];
  if (!p) return;
  const d = distance(body, p);
  body.yaw = Math.atan2(p.x - body.x, p.z - body.z);
  move(body, (p.x - body.x) / d * Math.min(d, speed * dt), (p.z - body.z) / d * Math.min(d, speed * dt));
}
