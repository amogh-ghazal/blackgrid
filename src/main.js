import './style.css';
import './theme.css';
import { GameScene } from './scene.js';
import { AudioEngine } from './audio.js';
import { VoiceRoom } from './voice.js';
import { $, show, toast, renderRooms, updateHUD } from './ui.js';

const audio = new AudioEngine();
let game, socket = null, state = null, selfId = null, joining = false, intentionalClose = false, lastCode = '', lastEvent = 0, latency = 0, voice = null;
let mouse = { x: innerWidth / 2, y: innerHeight / 2 }, firing = false, firePointer = null, fireTouch = null, keys = new Set(), touchMove = { x: 0, y: 0 }, touchSprint = false, paused = false, pingTimer, frameCount = 0, frameTime = 0, lastFrame = performance.now(), lastRender = performance.now(), renderAccumulator = 0;
let settings = { quality: 'medium', volume: 45, motion: false, name: '', qualityChosen: false };
let pendingJoinCode = null, lowFpsNotified = false, micPending = false;
try { const saved = JSON.parse(localStorage.getItem('blackgrid-settings') || '{}'); settings = { ...settings, ...saved }; if (saved.qualityChosen !== true) settings.quality = 'medium'; } catch {}
if (!['low', 'medium', 'high'].includes(settings.quality)) settings.quality = 'medium';
if (!settings.name || settings.name.toUpperCase() === 'SURVIVOR') settings.name = '';
settings.volume = Number.isFinite(Number(settings.volume)) ? Math.max(0, Math.min(100, Number(settings.volume))) : 45;
$('quality').value = settings.quality; $('volume').value = settings.volume; $('motion').checked = settings.motion === true; $('callsign').value = typeof settings.name === 'string' ? settings.name.slice(0, 16) : '';
$('volume-label').textContent = `${settings.volume}%`; audio.setVolume(settings.volume / 100);
const invite = new URLSearchParams(location.search).get('room');
if (invite) $('room-code').value = invite.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase();

function saveSettings() { try { localStorage.setItem('blackgrid-settings', JSON.stringify(settings)); } catch {} }
function send(data) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data)); }
function movementInput() {
  const yaw = game.aim(mouse.x, mouse.y);
  const forward = Number(keys.has('KeyW')) - Number(keys.has('KeyS')) - touchMove.y;
  // A / left-stick-left must move to the player's left in the same local basis
  // used by the actor model. Keep keyboard and touch movement aligned.
  const strafe = Number(keys.has('KeyA')) - Number(keys.has('KeyD')) - touchMove.x;
  return { type: 'input', x: forward * Math.sin(yaw) + strafe * Math.cos(yaw), z: forward * Math.cos(yaw) - strafe * Math.sin(yaw), yaw, sprint: touchSprint || keys.has('ShiftLeft') || keys.has('ShiftRight'), fire: firing };
}
function clearInput() { keys.clear(); firing = false; firePointer = null; fireTouch = null; lookTouch = null; moveTouch = null; touchMove.x = 0; touchMove.y = 0; touchSprint = false; if (typeof movePointer !== 'undefined' && movePointer !== null) { if (moveStick.hasPointerCapture(movePointer)) moveStick.releasePointerCapture(movePointer); movePointer = null; moveKnob.style.transform = 'translate(0, 0)'; } if (typeof lookPointer !== 'undefined' && lookPointer !== null) { if (lookPad.hasPointerCapture(lookPointer)) lookPad.releasePointerCapture(lookPointer); lookPointer = null; } if (socket?.readyState === WebSocket.OPEN && selfId) send(movementInput()); }
function setBusy(value) { joining = value; $('deploy').disabled = value; $('join-form').querySelector('button').disabled = value; $('deploy').textContent = value ? 'ESTABLISHING CONNECTION' : 'START AN OPERATION'; }
function setPause(value) { paused = value; show('pause', value); if (value) clearInput(); }
const modalOpen = () => paused || ['settings', 'field-guide', 'results', 'connection-lost', 'afterlight'].some(id => !$(id).classList.contains('hidden'));
function updateViewToggle(mode = game.viewMode) {
  $('view-toggle').textContent = `VIEW: ${mode === 'first' ? 'FIRST' : 'THIRD PERSON'} · V`;
  $('view-toggle').setAttribute('aria-label', `Switch to ${mode === 'first' ? 'third person' : 'first person'} view`);
}
function toggleView() { updateViewToggle(game.setView(game.viewMode === 'first' ? 'third' : 'first')); }
function fireStart() {
  if (!selfId || modalOpen()) return;
  firing = true; send({ type: 'action', action: 'fire', yaw: game.aim(mouse.x, mouse.y) }); audio.start().catch(() => {});
}
function microphoneState(enabled) {
  const button = $('mic-toggle');
  button.classList.toggle('is-live', enabled);
  button.setAttribute('aria-pressed', String(enabled));
  button.setAttribute('aria-label', enabled ? 'Mute microphone; currently audible to human players in this operation' : 'Enable microphone; audible to human players in this operation');
  button.title = enabled ? 'Microphone live · click to mute' : 'Voice chat muted · click to speak';
}
function isPortraitTouch() { return document.body.classList.contains('touch-device') && innerHeight > innerWidth; }
function continuePendingJoin() {
  if (isPortraitTouch() || pendingJoinCode === null) return;
  const code = pendingJoinCode; pendingJoinCode = null; show('orientation-gate', false); join(code);
}
function requestLandscape() {
  if (screen.orientation?.lock) screen.orientation.lock('landscape').then(continuePendingJoin).catch(() => {});
  if (!isPortraitTouch()) continuePendingJoin();
}

async function refreshRooms() {
  try {
    const [response, healthResponse] = await Promise.all([fetch('/api/rooms', { signal: AbortSignal.timeout(5000) }), fetch('/api/health', { signal: AbortSignal.timeout(5000) })]);
    if (!response.ok || !healthResponse.ok) throw new Error('Host unavailable');
    const [rooms, health] = await Promise.all([response.json(), healthResponse.json()]);
    renderRooms(rooms, join);
    $('online-count').textContent = `${health.players} ONLINE`;
    $('hud-online-count').textContent = `${health.players} ONLINE`;
    $('server-status').textContent = 'HOST ONLINE';
  } catch { $('server-status').textContent = 'NO SIGNAL'; $('room-list').textContent = 'Host unavailable. Check your connection.'; }
}
function appendChat(name, text) {
  const line = document.createElement('p'); line.className = 'chat-line';
  const speaker = document.createElement('b'); speaker.textContent = name;
  const message = document.createElement('span'); message.textContent = text;
  line.append(speaker, message); $('chat-log').append(line);
  while ($('chat-log').children.length > 60) $('chat-log').firstElementChild.remove();
  $('chat-log').scrollTop = $('chat-log').scrollHeight;
}
function enterAfterlight() { show('afterlight', false); show('social-panel', true); $('chat-input').focus(); }
function join(code = '') {
  if (joining) return;
  if (isPortraitTouch()) { pendingJoinCode = code; show('orientation-gate'); $('orientation-lock').focus(); requestLandscape(); return; }
  const name = $('callsign').value.trim().slice(0, 16);
  if (!name) { $('lobby-error').textContent = 'Enter your name before joining or starting an operation.'; $('callsign').focus(); return; }
  audio.start().catch(() => {});
  settings.name = name; saveSettings();
  $('lobby-error').textContent = ''; setBusy(true);
  if (socket) { socket.onclose = null; socket.close(); }
  clearInterval(pingTimer);
  intentionalClose = false;
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/socket`);
  socket = ws;
  ws.binaryType = 'arraybuffer';
  let welcomed = false;
  const timeout = setTimeout(() => { if (!welcomed) { $('lobby-error').textContent = 'Connection timed out. The host may be starting up.'; show('mission-loading', false); setBusy(false); ws.close(); } }, 10000);
  ws.onopen = () => ws.send(JSON.stringify({ type: 'join', name: settings.name, code: String(code).toUpperCase(), crew: Number($('crew-size').value), binaryState: typeof DecompressionStream === 'function', title: `${settings.name}'s operation` }));
  const receive = async event => {
    if (ws !== socket || intentionalClose) return;
    let message;
    try {
      const binary = typeof event.data !== 'string';
      const data = binary ? await new Response(new Blob([event.data]).stream().pipeThrough(new DecompressionStream('gzip'))).text() : event.data;
      message = JSON.parse(data);
      if (binary) ws.binaryState = true;
    } catch { ws.close(1003, 'Invalid state'); return; }
      if (message.type === 'error') { clearTimeout(timeout); show('mission-loading', false); $('lobby-error').textContent = message.message; if (!$('connection-lost').classList.contains('hidden')) $('connection-message').textContent = message.message; setBusy(false); if (!welcomed) ws.close(); return; }
    if (message.type === 'chat') { appendChat(message.name, message.text); return; }
    if (message.type === 'signal') { voice?.signal(message.from, message.signal).catch(() => {}); return; }
    if (message.type === 'voice-ready') { voice?.ready(message.from, state?.players.find(player => player.id === message.from)?.name).catch(() => {}); return; }
    if (message.type === 'voice-left') { voice?.removePeer(message.from); if (voice?.active) $('voice-status').textContent = `VOICE CONNECTED · ${voice.peers.size} PEER${voice.peers.size === 1 ? '' : 'S'}`; return; }
    if (message.type === 'welcome') {
      welcomed = true; clearTimeout(timeout); setBusy(false); show('mission-loading', false); selfId = message.id; lastCode = message.code; state = message.state; lastEvent = Math.max(0, ...state.events.map(e => e.id));
      for (const id of ['lobby', 'connection-lost', 'results', 'pause', 'settings', 'field-guide']) show(id, false);
      show('hud'); paused = false; document.body.classList.add('playing'); game.applyState(state, selfId); microphoneState(false);
      updateHUD(state, state.players.find(p => p.id === selfId));
      const inHub = state.phase === 'hub'; document.body.classList.toggle('social-mode', inHub); show('social-panel', false); show('afterlight', inHub); voice?.close(); voice = ['active', 'hub'].includes(state.phase) ? new VoiceRoom({ selfId, send, onStatus: text => { $('voice-status').textContent = text; } }) : null;
      $('comms-title').textContent = inHub ? 'AFTERLIGHT / SOCIAL LOUNGE' : 'CREW COMMS';
      if (inHub) { $('social-count').textContent = `${state.players.filter(player => !player.bot).length} HERE`; $('chat-log').replaceChildren(); appendChat('AFTERLIGHT', 'Welcome. This gathering space is shared by crews who restored the grid.'); }
      const url = new URL(location.href); url.searchParams.set('room', lastCode); history.replaceState({}, '', url);
      toast(inHub ? 'SIGNAL RESTORED. The city is waking up.' : 'SIGNAL ESTABLISHED. Collect amber cells. E to interact. F for your flashlight.');
      clearInterval(pingTimer); pingTimer = setInterval(() => send({ type: 'ping', at: performance.now() }), 2000);
      return;
    }
    if (message.type === 'pong') { latency = Math.round(performance.now() - message.at); $('ping').textContent = `${latency} ms`; return; }
    if (message.type === 'state' && selfId) {
      state = message.state; game.applyState(state, selfId);
      if (!['active', 'hub'].includes(state.phase) && voice?.active) { send({ type: 'voice-left' }); voice.close(); microphoneState(false); $('voice-status').textContent = 'VOICE OFF'; }
      if (state.phase === 'hub') $('social-count').textContent = `${state.players.filter(player => !player.bot).length} HERE`;
      voice?.sync(state.players);
      const me = state.players.find(p => p.id === selfId);
      if (me) { audio.listener = me; audio.movement(state); }
      for (const event of state.events) {
        if (event.id <= lastEvent) continue;
        lastEvent = event.id; game.effect(event);
        if (event.type === 'stage') { $('mission-loading-title').textContent = `OPERATION ${String(state.stage + 1).padStart(2, '0')} / DEPLOYING`; show('mission-loading'); setTimeout(() => show('mission-loading', false), 1450); }
        if (!['pickup', 'bite', 'turn'].includes(event.type) || event.player === selfId) audio.event(event);
        if (event.text && !['join', 'heal'].includes(event.type)) toast(event.text, ['bite', 'turn', 'defeat'].includes(event.type));
        if (event.type === 'pickup' && event.player === selfId) toast(`${event.item === 'battery' ? 'POWER CELL SECURED. Return it to the station.' : event.item.toUpperCase() + ' COLLECTED.'}`);
        if (event.type === 'hit' && event.player === selfId) { $('damage-flash').style.opacity = '0.65'; setTimeout(() => $('damage-flash').style.opacity = '0', 180); }
        if (event.type === 'impact' && event.player === selfId) { $('crosshair').classList.add('hit'); setTimeout(() => $('crosshair').classList.remove('hit'), 110); }
      }
      updateHUD(state, me);
    }
  };
  let incoming = Promise.resolve();
  ws.onmessage = event => { incoming = incoming.then(() => receive(event)).catch(() => ws.close(1003, 'Invalid state')); };
  ws.onclose = event => {
    clearTimeout(timeout); clearInterval(pingTimer); setBusy(false); clearInput();
    if (ws !== socket || intentionalClose) return;
    if (welcomed) { show('connection-lost'); $('connection-message').textContent = event.code === 1013 ? 'The connection could not keep up with the match. Try reconnecting on a faster network.' : 'The match host is no longer reachable. Rejoin if the host is still running; a new slot may replace an AI survivor.'; }
    else if (!$('lobby-error').textContent) $('lobby-error').textContent = 'Unable to join the host. Check the connection and try again.';
    show('mission-loading', false);
  };
  ws.onerror = () => { show('mission-loading', false); $('lobby-error').textContent = 'The match connection failed. Check that the server is running.'; };
  $('mission-loading-title').textContent = 'DEPLOYING INTO THE DARK'; show('mission-loading');
}
function leave() {
  intentionalClose = true; clearInput(); if (voice?.active) send({ type: 'voice-left' }); voice?.close(); voice = null; socket?.close(); socket = null; clearInterval(pingTimer);
  selfId = null; state = null; lastEvent = 0; paused = false; game.reset(); updateViewToggle(); microphoneState(false); show('mission-loading', false); document.body.classList.remove('playing', 'social-mode');
  for (const id of ['hud', 'pause', 'results', 'connection-lost', 'settings', 'field-guide', 'map-overlay', 'afterlight', 'social-panel']) show(id, false);
  show('lobby'); history.replaceState({}, '', location.pathname); refreshRooms();
}
$('deploy').addEventListener('click', () => join());
$('callsign').addEventListener('input', () => { if ($('callsign').value.trim()) $('lobby-error').textContent = ''; });
$('join-form').addEventListener('submit', event => { event.preventDefault(); const code = $('room-code').value.trim(); if (!/^[a-zA-Z0-9]{6}$/.test(code)) { $('lobby-error').textContent = 'Enter the six-character code from your crew.'; return; } join(code); });
$('refresh-rooms').addEventListener('click', refreshRooms);
$('settings-open').addEventListener('click', () => show('settings'));
$('hosting-open').addEventListener('click', () => show('hosting'));
$('hosting-close').addEventListener('click', () => show('hosting', false));
$('orientation-lock').addEventListener('click', requestLandscape);
window.addEventListener('resize', continuePendingJoin);
screen.orientation?.addEventListener?.('change', continuePendingJoin);
matchMedia('(orientation: landscape)').addEventListener?.('change', continuePendingJoin);
$('ingame-settings').addEventListener('click', () => { clearInput(); show('pause', false); show('settings'); });
$('field-guide-open').addEventListener('click', () => show('field-guide'));
$('ingame-guide').addEventListener('click', () => { clearInput(); show('pause', false); show('field-guide'); });
$('guide-close').addEventListener('click', () => { show('field-guide', false); if (selfId) setPause(false); });
$('settings-close').addEventListener('click', () => {
  settings.quality = $('quality').value; settings.qualityChosen = true; settings.volume = Number($('volume').value); settings.motion = $('motion').checked; saveSettings();
  game.setQuality(settings.quality); game.reducedMotion = settings.motion; audio.setVolume(settings.volume / 100); show('settings', false); if (selfId) setPause(false);
});
$('volume').addEventListener('input', () => { $('volume-label').textContent = `${$('volume').value}%`; audio.setVolume(Number($('volume').value) / 100); });
$('pause-open').addEventListener('click', () => setPause(true)); $('resume').addEventListener('click', () => setPause(false));
for (const id of ['leave', 'result-leave', 'disconnect-home']) $(id).addEventListener('click', leave);
$('reconnect').addEventListener('click', () => join(lastCode));
$('restart').addEventListener('click', () => { send({ type: 'restart' }); clearInput(); });
$('enter-afterlight').addEventListener('click', enterAfterlight);
$('enter-afterlight-results').addEventListener('click', enterAfterlight);
$('leave-afterlight-prompt').addEventListener('click', leave);
$('leave-afterlight').addEventListener('click', leave);
$('comms-open').addEventListener('click', () => { show('social-panel', $('social-panel').classList.contains('hidden')); if (!$('social-panel').classList.contains('hidden')) $('chat-input').focus(); });
$('comms-close').addEventListener('click', () => show('social-panel', false));
$('chat-form').addEventListener('submit', event => {
  event.preventDefault(); const text = $('chat-input').value.trim().slice(0, 120);
  if (!text || !['active', 'hub'].includes(state?.phase)) return;
  send({ type: 'chat', text }); $('chat-input').value = '';
});
$('mic-toggle').addEventListener('click', async () => {
  if (micPending || !['active', 'hub'].includes(state?.phase)) return;
  micPending = true; $('mic-toggle').disabled = true;
  try {
    if (!voice) voice = new VoiceRoom({ selfId, send, onStatus: text => { $('voice-status').textContent = text; } });
    if (!voice.active) $('voice-status').textContent = 'REQUESTING MICROPHONE PERMISSION…';
    if (!voice.active) await voice.enable(state.players);
    const enabled = !voice.stream?.getAudioTracks().some(track => track.enabled);
    voice.setTalking(enabled); microphoneState(enabled);
    $('voice-status').textContent = enabled ? 'MIC LIVE · HEARD BY HUMAN PLAYERS IN THIS ROOM' : 'MICROPHONE MUTED';
  } catch (error) {
    microphoneState(false);
    $('voice-status').textContent = error.name === 'NotAllowedError' ? 'MICROPHONE PERMISSION DENIED' : error.message || 'VOICE UNAVAILABLE';
    toast($('voice-status').textContent, true);
  } finally { micPending = false; $('mic-toggle').disabled = !['active', 'hub'].includes(state?.phase); }
});
$('copy-code').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(location.href); toast('INVITE LINK COPIED. Anyone with host access can join.'); }
  catch { toast(`ROOM CODE: ${lastCode} | Share this page address with your crew.`); }
});
window.addEventListener('keydown', event => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  if (event.code === 'Escape' && selfId) { event.preventDefault(); if (!modalOpen()) setPause(true); else if (paused) { show('settings', false); show('field-guide', false); setPause(false); } return; }
  if (!selfId || modalOpen()) return;
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'Tab', 'ShiftLeft', 'ShiftRight', 'KeyV'].includes(event.code)) event.preventDefault();
  keys.add(event.code);
  if (event.repeat) return;
  if (event.code === 'KeyV') {
    toggleView();
  }
  const actions = { KeyE: 'interact', KeyF: 'light', KeyR: 'reload', KeyH: 'heal' };
  if (actions[event.code]) send({ type: 'action', action: actions[event.code] });
  if (event.code === 'KeyM') show('map-overlay', $('map-overlay').classList.contains('hidden'));
});
window.addEventListener('keyup', event => {
  if (!keys.delete(event.code) || !selfId) return;
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight'].includes(event.code)) send(movementInput());
}, true);
window.addEventListener('mousemove', event => { if (document.body.classList.contains('touch-device')) return; mouse.x = event.clientX; mouse.y = event.clientY; $('crosshair').style.left = `${event.clientX}px`; $('crosshair').style.top = `${event.clientY}px`; });
$('world').addEventListener('mousedown', event => { if (event.button === 0) fireStart(); });
$('view-toggle').addEventListener('click', () => {
  toggleView();
});
window.addEventListener('mouseup', () => firing = false);
window.addEventListener('pointerup', event => { if (event.pointerId === firePointer) { firing = false; firePointer = null; } }, true);
window.addEventListener('pointercancel', event => { if (event.pointerId === firePointer) { firing = false; firePointer = null; } }, true);
window.addEventListener('blur', clearInput);
window.addEventListener('focus', clearInput);
window.addEventListener('contextmenu', event => { if (selfId) event.preventDefault(); });
$('world').addEventListener('wheel', event => { if (selfId && !modalOpen()) { event.preventDefault(); game.zoom = Math.max(0.7, Math.min(1.5, game.zoom + event.deltaY * 0.0005)); } }, { passive: false });
window.addEventListener('resize', () => {
  game?.resize();
  if (document.body.classList.contains('touch-device')) {
    mouse.x = innerWidth / 2; mouse.y = innerHeight / 2;
    $('crosshair').style.left = `${mouse.x}px`; $('crosshair').style.top = `${mouse.y}px`;
  }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) { clearInput(); audio.ctx?.suspend(); } else if (selfId) audio.start().catch(() => {}); });

if (navigator.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches) {
  document.body.classList.add('touch-device'); $('touch-controls').setAttribute('aria-hidden', 'false');
}
const moveStick = $('move-stick'), moveKnob = $('move-knob');
let movePointer = null, moveTouch = null;
function updateMoveStick(event) {
  const bounds = moveStick.getBoundingClientRect(), radius = bounds.width * 0.36;
  const dx = event.clientX - (bounds.left + bounds.width / 2), dy = event.clientY - (bounds.top + bounds.height / 2);
  const length = Math.hypot(dx, dy), scale = length > radius ? radius / length : 1;
  touchMove.x = dx * scale / radius; touchMove.y = dy * scale / radius;
  moveKnob.style.transform = `translate(${touchMove.x * radius}px, ${touchMove.y * radius}px)`;
}
moveStick.addEventListener('pointerdown', event => {
  event.preventDefault(); movePointer = event.pointerId; updateMoveStick(event);
  try { moveStick.setPointerCapture(movePointer); } catch { movePointer = null; }
});
moveStick.addEventListener('pointermove', event => { if (event.pointerId === movePointer) { event.preventDefault(); updateMoveStick(event); } });
function releaseMoveStick(event) {
  if (event.pointerId !== movePointer) return;
  try { if (moveStick.hasPointerCapture(event.pointerId)) moveStick.releasePointerCapture(event.pointerId); } catch {}
  movePointer = null; touchMove.x = 0; touchMove.y = 0; moveKnob.style.transform = 'translate(0, 0)';
}
moveStick.addEventListener('pointerup', releaseMoveStick); moveStick.addEventListener('pointercancel', releaseMoveStick);
moveStick.addEventListener('touchstart', event => {
  if (movePointer !== null || moveTouch !== null) return;
  event.preventDefault(); const touch = event.changedTouches[0]; if (!touch) return;
  moveTouch = touch.identifier; updateMoveStick(touch);
}, { passive: false });
moveStick.addEventListener('touchmove', event => {
  if (movePointer !== null || moveTouch === null) return;
  const touch = [...event.changedTouches].find(item => item.identifier === moveTouch);
  if (!touch) return;
  event.preventDefault(); updateMoveStick(touch);
}, { passive: false });
function releaseMoveTouch(event) {
  if (moveTouch === null || ![...event.changedTouches].some(touch => touch.identifier === moveTouch)) return;
  moveTouch = null; touchMove.x = 0; touchMove.y = 0; moveKnob.style.transform = 'translate(0, 0)';
}
moveStick.addEventListener('touchend', releaseMoveTouch, { passive: true });
moveStick.addEventListener('touchcancel', releaseMoveTouch, { passive: true });

const lookPad = $('look-pad');
let lookPointer = null, lookTouch = null, lookLast = { x: 0, y: 0 };
function moveAim(clientX, clientY) {
  mouse.x = Math.max(0, Math.min(innerWidth, mouse.x + (clientX - lookLast.x) * 0.8));
  mouse.y = Math.max(0, Math.min(innerHeight, mouse.y + (clientY - lookLast.y) * 0.45));
  lookLast = { x: clientX, y: clientY };
  $('crosshair').style.left = `${mouse.x}px`; $('crosshair').style.top = `${mouse.y}px`;
}
lookPad.addEventListener('pointerdown', event => {
  event.preventDefault(); lookPointer = event.pointerId; lookTouch = null;
  lookLast = { x: event.clientX, y: event.clientY };
  try { lookPad.setPointerCapture(lookPointer); } catch { lookPointer = null; }
});
lookPad.addEventListener('pointermove', event => {
  if (event.pointerId !== lookPointer) return;
  event.preventDefault(); moveAim(event.clientX, event.clientY);
});
function releaseLookPad(event) {
  if (event.pointerId !== lookPointer) return;
  try { if (lookPad.hasPointerCapture(event.pointerId)) lookPad.releasePointerCapture(event.pointerId); } catch {}
  lookPointer = null;
}
lookPad.addEventListener('pointerup', releaseLookPad); lookPad.addEventListener('pointercancel', releaseLookPad);
// Keep dragging functional on mobile browsers that dispatch Touch Events but
// do not provide reliable pointer capture outside the aim pad.
lookPad.addEventListener('touchstart', event => {
  if (lookPointer !== null || lookTouch !== null) return;
  event.preventDefault();
  const touch = event.changedTouches[0]; if (!touch) return;
  lookTouch = touch.identifier; lookLast = { x: touch.clientX, y: touch.clientY };
}, { passive: false });
lookPad.addEventListener('touchmove', event => {
  if (lookPointer !== null || lookTouch === null) return;
  const touch = [...event.changedTouches].find(item => item.identifier === lookTouch);
  if (!touch) return;
  event.preventDefault(); moveAim(touch.clientX, touch.clientY);
}, { passive: false });
function releaseLookTouch(event) {
  if (lookTouch !== null && [...event.changedTouches].some(touch => touch.identifier === lookTouch)) lookTouch = null;
}
lookPad.addEventListener('touchend', releaseLookTouch, { passive: true });
lookPad.addEventListener('touchcancel', releaseLookTouch, { passive: true });
$('touch-fire').addEventListener('pointerdown', event => { event.preventDefault(); firePointer = event.pointerId; $('touch-fire').setPointerCapture(firePointer); fireStart(); });
$('touch-sprint').addEventListener('pointerdown', event => { event.preventDefault(); $('touch-sprint').setPointerCapture(event.pointerId); touchSprint = true; });
function releaseTouchSprint() { touchSprint = false; }
$('touch-sprint').addEventListener('pointerup', releaseTouchSprint); $('touch-sprint').addEventListener('pointercancel', releaseTouchSprint);
$('touch-fire').addEventListener('pointerup', event => { if ($('touch-fire').hasPointerCapture(event.pointerId)) $('touch-fire').releasePointerCapture(event.pointerId); if (event.pointerId === firePointer) { firing = false; firePointer = null; } });
$('touch-fire').addEventListener('pointercancel', event => { if (event.pointerId === firePointer) { firing = false; firePointer = null; } });
$('touch-fire').addEventListener('touchstart', event => { fireTouch = event.changedTouches[0]?.identifier ?? null; }, { passive: true });
$('touch-fire').addEventListener('touchend', event => { if (fireTouch !== null && [...event.changedTouches].some(touch => touch.identifier === fireTouch)) { firing = false; firePointer = null; fireTouch = null; } }, { passive: true });
$('touch-fire').addEventListener('touchcancel', () => { firing = false; firePointer = null; fireTouch = null; }, { passive: true });
window.addEventListener('touchend', event => { if (fireTouch !== null && [...event.changedTouches].some(touch => touch.identifier === fireTouch)) { firing = false; firePointer = null; fireTouch = null; } }, { passive: true, capture: true });
window.addEventListener('touchcancel', () => { if (fireTouch !== null) { firing = false; firePointer = null; fireTouch = null; } }, { passive: true, capture: true });
for (const button of document.querySelectorAll('[data-touch-action]')) button.addEventListener('click', () => {
  if (!selfId || modalOpen()) return;
  const action = button.dataset.touchAction;
  if (action === 'map') show('map-overlay', $('map-overlay').classList.contains('hidden'));
  else { send({ type: 'action', action: action === 'interact' ? 'interact' : action }); if (action === 'interact') audio.start().catch(() => {}); }
});
setInterval(() => {
  if (!selfId || !state || modalOpen() || document.hidden || !['active', 'hub'].includes(state.phase)) return;
  send(movementInput());
}, 50);
setInterval(refreshRooms, 5000);

let perfWindow = 0, perfFrames = 0, lowFpsWindows = 0;
function render(now) {
  requestAnimationFrame(render);
  const dt = Math.min((now - lastFrame) / 1000, 0.1); lastFrame = now; renderAccumulator += dt;
  if (document.hidden || renderAccumulator < (selfId ? 1 / 62 : 1 / 32)) return;
  const step = Math.min(renderAccumulator, 0.1); renderAccumulator = 0;
  game.update(step); frameCount++; frameTime += (now - lastRender) / 1000; lastRender = now;
  if (frameTime >= 1) { const measured = frameCount / frameTime; $('fps').textContent = `${Math.round(measured)} FPS`; frameCount = 0; frameTime = 0; perfWindow += measured; perfFrames++; if (perfFrames >= 3) { const average = perfWindow / perfFrames; perfWindow = 0; perfFrames = 0; lowFpsWindows = average < 43 ? lowFpsWindows + 1 : 0; if (lowFpsWindows >= 2 && !lowFpsNotified) { lowFpsNotified = true; toast('LOW FRAME RATE: For smoother play, try a desktop, or lower the graphics preset in Settings.', true); } } }
}
try {
  game = new GameScene($('world')); game.setQuality(settings.quality); game.reducedMotion = settings.motion;
  show('loading', false); show('lobby');
  $('crosshair').style.left = `${mouse.x}px`; $('crosshair').style.top = `${mouse.y}px`;
  requestAnimationFrame(render); refreshRooms();
  window.__BLACKGRID__ = { get diagnostics() { const me = state?.players.find(p => p.id === selfId); return { connected: socket?.readyState === WebSocket.OPEN, room: lastCode, player: selfId, x: me?.x, z: me?.z, yaw: me?.yaw, light: me?.light, phase: state?.phase, humans: state?.players.filter(p => !p.bot).length, nameTags: [...game.actors.values()].filter(actor => actor.userData.nameTag).length, crew: state?.players.length, zombies: state?.zombies.length, drawCalls: game.renderer.info.render.calls, triangles: game.renderer.info.render.triangles, quality: game.quality, view: game.viewMode, firing, firePointer, networkCodec: socket?.binaryState ? 'gzip' : 'json', latency }; } };
} catch (error) {
  console.error('BLACKGRID renderer could not start:', error);
  $('loading').replaceChildren();
  const title = document.createElement('h2'); title.textContent = 'The renderer could not start.';
  const detail = document.createElement('p'); detail.textContent = 'Enable hardware acceleration and WebGL 2 in Chrome or Edge, then reload.';
  const retry = document.createElement('button'); retry.textContent = 'RELOAD'; retry.className = 'secondary-button'; retry.addEventListener('click', () => location.reload());
  $('loading').append(title, detail, retry);
}
