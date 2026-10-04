import { WORLD, STAGES, WEAPONS, STATION, EXTRACTION, distance, clamp, nearestInteraction, isIlluminated } from '../shared/world.js';

export const $ = id => document.getElementById(id);
export const show = (id, visible = true) => $(id).classList.toggle('hidden', !visible);
export const clock = seconds => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
const text = (id, value) => { const node = $(id); if (node.textContent !== String(value)) node.textContent = value; };
export function toast(message, danger = false) {
  const el = document.createElement('div'); el.className = `toast${danger ? ' danger' : ''}`; el.textContent = message;
  $('toast-stack').append(el);
  while ($('toast-stack').children.length > 3) $('toast-stack').firstChild.remove();
  setTimeout(() => el.remove(), 5500);
}
export function renderRooms(rooms, join) {
  $('room-list').replaceChildren();
  const active = rooms.filter(r => r.phase === 'active' && r.humans < 15);
  if (!active.length) { const p = document.createElement('p'); p.className = 'empty-rooms'; p.textContent = 'No open signals. Start the first operation.'; $('room-list').append(p); return; }
  for (const room of active) {
    const button = document.createElement('button'); button.className = 'room-entry';
    const name = document.createElement('b'); name.textContent = room.code;
    const detail = document.createElement('span'); detail.textContent = `${room.humans}/15  /  OP ${room.stage + 1}`;
    button.append(name, detail); button.addEventListener('click', () => join(room.code)); $('room-list').append(button);
  }
}
let crewKey = '';
export function updateHUD(state, me) {
  if (!me) return;
  text('room-label', state.code);
  text('operation-label', `OPERATION 0${state.stage + 1} / ${STAGES[state.stage]}`);
  const powered = state.power >= state.required;
  text('objective-title', powered ? 'Reach the evacuation zone' : 'Restore the power station');
  $('power-fill').style.width = `${state.power / state.required * 100}%`;
  text('power-label', powered ? 'GRID ONLINE / SOUTH EXIT OPEN' : `${state.power} / ${state.required} POWER CELLS INSTALLED`);
  text('objective-distance', `${Math.round(distance(me, powered ? EXTRACTION : STATION))} M`);
  text('objective-hint', powered ? 'Move south. Press E at the evacuation marker.' : me.batteries ? 'Power cell secured. Return to the central station.' : 'Find amber cells. Press E nearby to collect.');
  if (me.infected) {
    text('objective-title', 'Hunt the remaining survivors');
    text('objective-hint', 'Dark survivors are invisible. Listen for shots, footsteps, and engines.');
  }
  text('health-number', Math.ceil(me.health));
  $('health-fill').style.width = `${clamp(me.health / (me.infected ? 170 : 100) * 100, 0, 100)}%`;
  $('health-fill').style.background = me.health < 35 || me.infected ? '#dd8468' : '#b2c8b0';
  text('health-caption', me.infected ? 'VITAL SIGNS\nINFECTED' : me.health < 35 ? 'VITAL SIGNS\nCRITICAL' : 'VITAL SIGNS\nSTABLE');
  $('stamina-fill').style.width = `${me.stamina}%`;
  text('medkit-number', me.medkits); text('battery-number', `${me.batteries} / 2`);
  text('weapon-name', me.vehicle ? 'UTILITY / INTERCEPTOR' : me.infected ? 'INFECTED / CLOSE QUARTERS' : WEAPONS[me.weapon].name);
  text('ammo-number', me.vehicle ? Math.round((state.cars.find(c => c.id === me.vehicle)?.speed || 0) * 3.6) : me.infected ? 'N/A' : me.ammo);
  text('reserve-number', me.vehicle ? 'KM/H' : me.infected ? 'MELEE' : me.reserve);
  text('weapon-status', me.dead ? `REANIMATING / ${Math.max(0, Math.ceil(me.respawnAt - state.time))}S` : me.vehicle ? 'WASD DRIVE / E EXIT / ENGINE AUDIBLE' : me.infected ? 'BITE TO ATTACK / HUNT SURVIVORS' : me.reloadAt ? 'RELOADING…' : me.light ? 'FLASHLIGHT ON / YOU ARE VISIBLE' : 'LIGHT OFF / STAY QUIET');
  const bite = me.infected;
  text('touch-fire', bite ? 'BITE' : 'FIRE');
  $('touch-fire').setAttribute('aria-label', bite ? 'Hold to bite nearby survivors' : 'Hold to fire');
  $('touch-fire').classList.toggle('is-bite', bite);
  $('mic-toggle').disabled = !['active', 'hub'].includes(state.phase);
  text('adaptation-label', ['INSTINCTIVE', 'PATTERN SEEKING', 'COORDINATED', 'RELENTLESS'][state.adaptation]);
  [...$('adaptation-bars').children].forEach((el, index) => el.classList.toggle('active', index < state.adaptation));
  show('infection-alert', me.infection > 0 && !me.infected); text('infection-count', Math.ceil(me.infection));
  show('infected-banner', me.infected);
  const interaction = nearestInteraction(me, state);
  show('interaction', Boolean(interaction));
  if (interaction) $('interaction').querySelector('span').textContent = interaction.label.toUpperCase();
  const humans = state.players.filter(p => !p.bot).length;
  text('crew-count', `${humans} HUMAN / ${state.players.length - humans} AI`);
  const key = state.players.map(p => `${p.id}:${Math.ceil(p.health / 10)}:${p.infected}:${p.dead}`).join('|');
  if (key !== crewKey) {
    crewKey = key; $('crew-list').replaceChildren();
    for (const p of [...state.players].sort((a, b) => Number(b.id === me.id) - Number(a.id === me.id)).slice(0, 8)) {
      const row = document.createElement('div'); row.className = 'crew-row';
      const dot = document.createElement('i'); dot.className = 'crew-indicator'; dot.style.background = p.infected ? '#cb7d61' : p.dead ? '#777' : '#9bbda9';
      const name = document.createElement('span'); name.textContent = p.name + (p.id === me.id ? ' / YOU' : '');
      const tag = document.createElement('small'); tag.textContent = p.infected ? 'INF' : p.bot ? 'AI' : 'LIVE';
      const bar = document.createElement('div'); bar.className = 'bar'; bar.style.width = `${Math.max(0, p.health / (p.infected ? 170 : 100) * 25)}px`;
      row.append(dot, name, tag, bar); $('crew-list').append(row);
    }
    if (state.players.length > 8) { const more = document.createElement('div'); more.className = 'crew-row'; more.textContent = `+ ${state.players.length - 8} more in operation`; $('crew-list').append(more); }
  }
  text('match-time', clock(state.time));
  drawMap($('minimap'), state, me);
  if (!$('map-overlay').classList.contains('hidden')) drawMap($('large-map'), state, me);
  if (state.phase === 'hub') show('results', false);
  if (state.phase !== 'active' && state.phase !== 'hub') {
    show('results');
    const won = state.phase === 'won';
    text('result-eyebrow', won ? 'OPERATION COMPLETE / SIGNAL RESTORED' : 'OPERATION LOST / SIGNAL TERMINATED');
    text('result-title', won ? 'The light lives on.' : 'The dark took everyone.');
    text('result-description', won ? 'Three districts restored. Your crew brought a city back from the edge.' : 'No uninfected survivors remain. Rethink your routes, stay quiet, and try again.');
    text('result-kills', me.kills); text('result-cells', me.delivered); text('result-time', clock(state.time));
    $('restart').disabled = state.owner !== me.id;
    $('restart').textContent = state.owner === me.id ? 'ANOTHER NIGHT' : 'WAITING FOR CREW LEADER';
  }
}
export function drawMap(canvas, state, me) {
  const ctx = canvas.getContext('2d'), w = canvas.width, scale = w / 180;
  const map = (x, z) => [(x + 90) * scale, (z + 90) * scale];
  ctx.clearRect(0, 0, w, w); ctx.fillStyle = '#0c1d20'; ctx.fillRect(0, 0, w, w);
  ctx.strokeStyle = '#46605138'; ctx.lineWidth = 0.6;
  for (let i = 0; i <= 6; i++) { ctx.beginPath(); ctx.moveTo(i * w / 6, 0); ctx.lineTo(i * w / 6, w); ctx.moveTo(0, i * w / 6); ctx.lineTo(w, i * w / 6); ctx.stroke(); }
  ctx.fillStyle = '#394d47';
  for (const b of WORLD.buildings) { const [x, y] = map(b.x - b.w / 2, b.z - b.d / 2); ctx.fillRect(x, y, b.w * scale, b.d * scale); }
  ctx.strokeStyle = '#85957a33'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, w); ctx.stroke();
  const dot = (entity, color, radius) => { const [x, y] = map(entity.x, entity.z); ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill(); };
  for (const s of state.supplies) if (s.type === 'battery') { const [x, y] = map(s.x, s.z); ctx.fillStyle = '#e9ba72'; ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4); ctx.fillRect(-2 * scale, -2 * scale, 4 * scale, 4 * scale); ctx.restore(); }
  for (const z of state.zombies) if (distance(me, z) < 26) dot(z, '#d27e5f', Math.max(1.4, scale * 0.7));
  for (const car of state.cars) dot(car, '#78867a', Math.max(1.5, scale));
  for (const p of state.players) if (!p.dead && p.id !== me.id && (!me.infected || p.infected || isIlluminated(state, p))) dot(p, p.infected ? '#d68a6b' : '#8dc4ba', Math.max(2, 1.2 * scale));
  const [sx, sy] = map(0, 0); ctx.strokeStyle = state.power >= state.required ? '#add39b' : '#e9ba72'; ctx.lineWidth = 1.5 * scale; ctx.strokeRect(sx - 4 * scale, sy - 4 * scale, 8 * scale, 8 * scale);
  if (state.power >= state.required) { const [x, y] = map(EXTRACTION.x, EXTRACTION.z); ctx.strokeStyle = '#aad39f'; ctx.beginPath(); ctx.arc(x, y, 6 * scale, 0, Math.PI * 2); ctx.stroke(); }
  const [px, py] = map(me.x, me.z); ctx.save(); ctx.translate(px, py); ctx.rotate(-me.yaw); ctx.fillStyle = me.infected ? '#e58f6c' : '#f4e3b6'; ctx.beginPath(); ctx.moveTo(0, 4.5 * scale); ctx.lineTo(-2.6 * scale, -3 * scale); ctx.lineTo(2.6 * scale, -3 * scale); ctx.closePath(); ctx.fill(); ctx.restore();
  ctx.fillStyle = '#889e92'; ctx.font = `${Math.max(8, 3.2 * scale)}px monospace`; ctx.fillText('N', 6, 13);
}
