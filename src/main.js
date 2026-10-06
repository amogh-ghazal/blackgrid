import './style.css';
import './theme.css';
import { GameScene } from './scene.js';
import { AudioEngine } from './audio.js';
import { VoiceRoom } from './voice.js';
import { $, show, toast, renderRooms, updateHUD, drawMap } from './ui.js';

const audio = new AudioEngine();
let game, socket = null, state = null, selfId = null, joining = false, intentionalClose = false, lastCode = '', lastEvent = 0, latency = 0, voice = null;
let mouse = { x: innerWidth / 2, y: innerHeight / 2 }, firing = false, firePointer = null, fireTouch = null, keys = new Set(), touchMove = { x: 0, y: 0 }, touchSprint = false, paused = false, pingTimer, frameCount = 0, frameTime = 0, lastFrame = performance.now(), lastRender = performance.now(), renderAccumulator = 0;
let settings = { quality: 'medium', volume: 45, motion: false, name: '', qualityChosen: false };
let pendingJoinCode = null, lowFpsNotified = false, micPending = false;
let account = null, authRequired = true, loginOriginUnsupported = false, mobileDevice = navigator.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches;
try { const saved = JSON.parse(localStorage.getItem('blackgrid-settings') || '{}'); settings = { ...settings, ...saved }; if (saved.qualityChosen !== true) settings.quality = mobileDevice ? 'high' : 'medium'; } catch {}
if (!['low', 'medium', 'high'].includes(settings.quality)) settings.quality = 'medium';
if (!settings.name || settings.name.toUpperCase() === 'SURVIVOR') settings.name = '';
settings.volume = Number.isFinite(Number(settings.volume)) ? Math.max(0, Math.min(100, Number(settings.volume))) : 45;
$('quality').value = settings.quality; $('volume').value = settings.volume; $('motion').checked = settings.motion === true; $('callsign').value = '';
if (mobileDevice) { $('graphics-setting').classList.add('hidden'); $('mobile-graphics-note').classList.remove('hidden'); $('quality').value = 'high'; settings.quality = 'high'; }
$('volume-label').textContent = `${settings.volume}%`; audio.setVolume(settings.volume / 100);
const invite = new URLSearchParams(location.search).get('room');
if (invite) $('room-code').value = invite.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase();

function saveSettings() { try { localStorage.setItem('blackgrid-settings', JSON.stringify(settings)); } catch {} }
const GOOGLE_CLIENT_ID = '639238474808-kb8fr4gudaskm0596apsqnpg6jns76ho.apps.googleusercontent.com';
const CANONICAL_GAME_ORIGIN = 'https://blackgrid-5obd.onrender.com';
const isSupportedLoginOrigin = () => location.origin === CANONICAL_GAME_ORIGIN || (['localhost', '127.0.0.1'].includes(location.hostname) && location.protocol === 'http:');
const isIOSBrowser = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function renderAccount() {
  $('auth-status').textContent = account ? 'Signed in as ' + account.name + '. This device stays signed in until you log out.' : 'Sign in to play. Your Google profile name will be your in-game name.';
  $('callsign').classList.toggle('hidden', authRequired);
  if (!authRequired) { $('callsign').placeholder = 'ENTER YOUR NAME'; $('callsign').setAttribute('aria-label', 'Player name'); }
  $('google-signin').classList.toggle('hidden', Boolean(account) || !authRequired);
  $('logout').classList.toggle('hidden', !account); $('friends-open').classList.toggle('hidden', !account);
  $('deploy').disabled = authRequired && !account; $('join-form').querySelector('button').disabled = authRequired && !account;
}
async function acceptGoogleCredential(credential) {
  try {
    const response = await fetch('/api/auth/google', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential }) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Google sign-in failed.');
    account = result.user; renderAccount(); presence(); toast('WELCOME, ' + account.name.toUpperCase());
  } catch (error) { $('auth-status').textContent = error.message; }
}
async function initializeAuth() {
  try {
    const response = await fetch('/api/auth/session', { cache: 'no-store' }); const result = await response.json();
    authRequired = result.required === true; account = result.user || null; loginOriginUnsupported = authRequired && !isSupportedLoginOrigin(); renderAccount();
    if (!account && !localStorage.getItem('blackgrid-how-to-play-v1')) show('how-to-play');
    if (loginOriginUnsupported) { const link = document.createElement('a'); link.href = CANONICAL_GAME_ORIGIN + location.search; link.textContent = 'Open the secure BLACKGRID link'; link.rel = 'noopener'; $('auth-status').replaceChildren(document.createTextNode('Google sign-in is only enabled on the secure game address. '), link); return; }
    if (!account && authRequired) {
      const script = document.createElement('script'); script.src = 'https://accounts.google.com/gsi/client'; script.async = true; script.defer = true;
      script.onload = () => { const config = { client_id: GOOGLE_CLIENT_ID, auto_select: false, itp_support: true }; if (isIOSBrowser && location.origin === CANONICAL_GAME_ORIGIN) { config.ux_mode = 'redirect'; config.login_uri = CANONICAL_GAME_ORIGIN + '/api/auth/google'; } else config.callback = ({ credential }) => acceptGoogleCredential(credential); window.google?.accounts.id.initialize(config); window.google?.accounts.id.renderButton($('google-signin'), { theme: 'outline', size: 'large', shape: 'rectangular', text: 'signin_with', width: 280 }); };
      script.onerror = () => { $('auth-status').textContent = 'Google sign-in did not load. Check your connection and reload.'; }; document.head.append(script);
    }
  } catch { $('auth-status').textContent = 'Unable to check sign-in. Reload to retry.'; }
}
async function presence() { if (account) fetch('/api/auth/presence', { method: 'POST', keepalive: true }).catch(() => {}); }
const friendsKey = () => 'blackgrid-friends-' + (account?.sub || '');
async function showFriends() {
  show('friends'); const list = $('friends-list'); list.replaceChildren();
  try {
    const response = await fetch('/api/users/online', { cache: 'no-store' }); const online = response.ok ? await response.json() : [];
    const ids = new Set(JSON.parse(localStorage.getItem(friendsKey()) || '[]'));
    for (const user of online) { const row = document.createElement('div'); row.className = 'friend-row'; const label = document.createElement('span'); label.textContent = user.name + (ids.has(user.sub) ? ' · FRIEND / ONLINE' : ' · ONLINE'); const action = document.createElement('button'); action.className = 'secondary-button'; action.textContent = ids.has(user.sub) ? 'REMOVE' : 'ADD FRIEND'; action.onclick = () => { if (ids.has(user.sub)) ids.delete(user.sub); else ids.add(user.sub); localStorage.setItem(friendsKey(), JSON.stringify([...ids])); showFriends(); }; row.append(label, action); list.append(row); }
    const offline = [...ids].filter(id => !online.some(user => user.sub === id));
    for (const sub of offline) { const row = document.createElement('div'); row.className = 'friend-row'; const label = document.createElement('span'); label.textContent = 'FRIEND · OFFLINE'; const remove = document.createElement('button'); remove.className = 'secondary-button'; remove.textContent = 'REMOVE'; remove.onclick = () => { ids.delete(sub); localStorage.setItem(friendsKey(), JSON.stringify([...ids])); showFriends(); }; row.append(label, remove); list.append(row); }
    if (!online.length && !offline.length) { const note = document.createElement('p'); note.className = 'settings-note'; note.textContent = 'No other players are online yet. Check again later to add them.'; list.append(note); }
  } catch { list.textContent = 'Friends list is temporarily unavailable.'; }
}
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
const modalOpen = () => paused || ['settings', 'field-guide', 'results', 'connection-lost', 'afterlight', 'mission-briefing', 'how-to-play'].some(id => !$(id).classList.contains('hidden'));
function updateViewToggle(mode = game.viewMode) {
  $('view-toggle').textContent = `VIEW: ${mode === 'first' ? 'FIRST' : 'THIRD PERSON'} · V`;
  $('view-toggle').setAttribute('aria-label', `Switch to ${mode === 'first' ? 'third person' : 'first person'} view`);
}
function toggleView() { updateViewToggle(game.setView(game.viewMode === 'first' ? 'third' : 'first')); }
function toggleMap() { const visible = $('map-overlay').classList.contains('hidden'); show('map-overlay', visible); const me = state?.players.find(player => player.id === selfId); if (visible && state && me) drawMap($('large-map'), state, me); }
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

let briefingTimer = 0, briefingSignature = '';
function closeMissionBriefing() {
  if ($('mission-briefing').classList.contains('hidden') || $('mission-briefing').classList.contains('closing')) return;
  clearInterval(briefingTimer); clearInput(); send({ type: 'action', action: 'briefing-done' });
  $('mission-briefing').classList.add('closing');
  setTimeout(() => { show('mission-briefing', false); $('mission-briefing').classList.remove('closing'); }, 420);
}
function openMissionBriefing(current) {
  if (!current || current.phase !== 'active' || current.briefingDone) return;
  const signature = current.code + ':' + current.briefingId;
  if (signature === briefingSignature) return;
  briefingSignature = signature; clearInterval(briefingTimer); clearInput();
  const title = ['Cold Start', 'The Relay', 'Last Light'][current.stage] || 'Operation';
  const descriptions = [
    'Recover three power cells scattered through the district. Install all three at the central station, then move south to the evacuation zone.',
    'The relay is failing. Find three cells, restore the grid and keep the route south clear for your crew.',
    'One final district stands between your crew and extraction. Install three cells at the station, then evacuate south.'
  ];
  $('briefing-eyebrow').textContent = 'FIELD DEPLOYMENT / OPERATION 0' + (current.stage + 1);
  $('briefing-title').textContent = title; $('briefing-description').textContent = descriptions[current.stage] || descriptions[2];
  show('mission-briefing'); $('mission-briefing').classList.remove('closing');
  const total = Math.max(0, (current.briefingUntil || (current.time + 16)) - current.time), started = Date.now();
  const tick = () => { const left = Math.max(0, total - (Date.now() - started) / 1000); $('briefing-countdown').style.transform = 'scaleX(' + (left / Math.max(total, 0.1)) + ')'; if (!left) closeMissionBriefing(); };
  tick(); briefingTimer = setInterval(tick, 100);
}
$('briefing-proceed').addEventListener('click', closeMissionBriefing);
$('how-understood').addEventListener('change', () => { $('how-continue').disabled = !$('how-understood').checked; });
$('how-continue').addEventListener('click', () => { if (!$('how-understood').checked) return; localStorage.setItem('blackgrid-how-to-play-v1', '1'); $('how-to-play').classList.add('closing'); setTimeout(() => { show('how-to-play', false); $('how-to-play').classList.remove('closing'); }, 420); });

function join(code = '') {
  if (joining) return;
  if (isPortraitTouch()) { pendingJoinCode = code; show('orientation-gate'); $('orientation-lock').focus(); requestLandscape(); return; }
  if (authRequired && !account) { $('lobby-error').textContent = 'Sign in with Google before joining or starting an operation.'; return; }
  const name = (account?.name || $('callsign').value).trim().slice(0, 32);
  if (!name) { $('lobby-error').textContent = 'Your account name is required to join.'; return; }
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
    } catch (error) { console.error('BLACKGRID state decode failed:', error); ws.close(4003, 'Invalid state'); return; }
      if (message.type === 'error') { clearTimeout(timeout); show('mission-loading', false); $('lobby-error').textContent = message.message; if (!$('connection-lost').classList.contains('hidden')) $('connection-message').textContent = message.message; setBusy(false); if (!welcomed) ws.close(); return; }
    if (message.type === 'chat') { appendChat(message.name, message.text); return; }
    if (message.type === 'signal') { voice?.signal(message.from, message.signal).catch(() => {}); return; }
    if (message.type === 'voice-ready') { voice?.ready(message.from, state?.players.find(player => player.id === message.from)?.name).catch(() => {}); return; }
    if (message.type === 'voice-left') { voice?.removePeer(message.from); if (voice?.active) $('voice-status').textContent = `VOICE CONNECTED · ${voice.peers.size} PEER${voice.peers.size === 1 ? '' : 'S'}`; return; }
    if (message.type === 'welcome') {
      welcomed = true; clearTimeout(timeout); setBusy(false); show('mission-loading', false); selfId = message.id; lastCode = message.code; state = message.state; lastEvent = Math.max(0, ...state.events.map(e => e.id));
      for (const id of ['lobby', 'connection-lost', 'results', 'pause', 'settings', 'field-guide']) show(id, false);
      show('hud'); paused = false; briefingSignature = ''; document.body.classList.add('playing'); game.applyState(state, selfId); openMissionBriefing(state); microphoneState(false);
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
        if (event.type === 'stage') { $('mission-loading-title').textContent = `OPERATION ${String(state.stage + 1).padStart(2, '0')} / DEPLOYING`; show('mission-loading'); setTimeout(() => show('mission-loading', false), 1450); openMissionBriefing(state); }
        if (!['pickup', 'bite', 'turn'].includes(event.type) || event.player === selfId) audio.event(event);
        if (event.text && !['join', 'heal', 'kill', 'reinforcements', 'ammo', 'mark', 'stage'].includes(event.type)) toast(event.text, ['bite', 'turn', 'defeat'].includes(event.type));
        if (event.type === 'pickup' && event.player === selfId) toast(`${event.item === 'battery' ? 'POWER CELL SECURED. Return it to the station.' : event.item.toUpperCase() + ' COLLECTED.'}`);
        if (event.type === 'ammo' && event.player === selfId) toast('DRONE AMMO COLLECTED.');
        if (event.type === 'power' && state.power < state.required) toast('POWER CELL INSTALLED. ' + (state.required - state.power) + ' MORE TO GO.');
        if (event.type === 'objective' && state.power >= state.required) toast('GRID ONLINE. HEAD SOUTH TO THE EVACUATION ZONE.');
        if (event.type === 'hit' && event.player === selfId) { $('damage-flash').style.opacity = '0.65'; setTimeout(() => $('damage-flash').style.opacity = '0', 180); }
        if (event.type === 'impact' && event.player === selfId) { $('crosshair').classList.add('hit'); setTimeout(() => $('crosshair').classList.remove('hit'), 110); }
      }
      updateHUD(state, me);
    }
  };
  let incoming = Promise.resolve();
  ws.onmessage = event => { incoming = incoming.then(() => receive(event)).catch(error => { console.error('BLACKGRID message processing failed:', error); ws.close(4003, 'Invalid state'); }); };
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
  selfId = null; state = null; lastEvent = 0; briefingSignature = ''; paused = false; game.reset(); updateViewToggle(); microphoneState(false); show('mission-loading', false); document.body.classList.remove('playing', 'social-mode');
  for (const id of ['hud', 'pause', 'results', 'connection-lost', 'settings', 'field-guide', 'map-overlay', 'afterlight', 'social-panel']) show(id, false);
  show('lobby'); history.replaceState({}, '', location.pathname); refreshRooms();
}
$('deploy').addEventListener('click', () => join());
$('callsign').addEventListener('input', () => { if ($('callsign').value.trim()) $('lobby-error').textContent = ''; });
$('join-form').addEventListener('submit', event => { event.preventDefault(); const code = $('room-code').value.trim(); if (!/^[a-zA-Z0-9]{6}$/.test(code)) { $('lobby-error').textContent = 'Enter the six-character code from your crew.'; return; } join(code); });
$('refresh-rooms').addEventListener('click', refreshRooms);
$('logout').addEventListener('click', async () => { await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {}); if (socket) leave(); account = null; localStorage.removeItem(friendsKey()); renderAccount(); $('auth-status').textContent = 'You are signed out. Sign in again to play.'; window.google?.accounts.id.disableAutoSelect(); });
$('friends-open').addEventListener('click', showFriends);
$('friends-close').addEventListener('click', () => show('friends', false));
$('friend-add').addEventListener('click', () => { const id = $('friend-code').value.trim(); if (!id || !account) return; try { const ids = new Set(JSON.parse(localStorage.getItem(friendsKey()) || '[]')); ids.add(id); localStorage.setItem(friendsKey(), JSON.stringify([...ids])); $('friend-code').value = ''; showFriends(); } catch {} });
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
  if (event.code === 'KeyM') toggleMap();
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
$('world').addEventListener('wheel', event => { if (selfId && !modalOpen()) { event.preventDefault(); if (!mobileDevice) game.zoom = Math.max(0.7, Math.min(1.5, game.zoom + event.deltaY * 0.0005)); } }, { passive: false });
if (mobileDevice) {
  const blockZoom = event => event.preventDefault();
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(type, blockZoom, { passive: false });
  document.addEventListener('touchmove', event => { if (event.touches.length > 1) event.preventDefault(); }, { passive: false });
  document.addEventListener('dblclick', event => event.preventDefault(), { passive: false });
}
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
  if (lookTouch !== null && [...event.changedTouches].some(touch => touch.identifier === lookTouch)) { lookTouch = null; lookKnob.style.transform = 'translate(0, 0)'; }
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

$('large-map').addEventListener('click', event => {
  if (!selfId || !state) return;
  const rect = event.currentTarget.getBoundingClientRect();
  const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * 180 - 90;
  const z = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) * 180 - 90;
  send({ type: 'action', action: 'map-mark', yaw: { x, z } }); toast('TEAM MARKER UPDATED.');
});
$('map-unmark').addEventListener('click', () => { if (!selfId) return; send({ type: 'action', action: 'map-unmark' }); toast('YOUR TEAM MARKER CLEARED.'); });

for (const button of document.querySelectorAll('[data-touch-action]')) button.addEventListener('click', () => {
  if (!selfId || modalOpen()) return;
  const action = button.dataset.touchAction;
  if (action === 'map') toggleMap();
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
  show('loading', false); show('lobby'); initializeAuth(); setInterval(presence, 30000);
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
