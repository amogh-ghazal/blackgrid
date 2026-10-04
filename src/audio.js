export class AudioEngine {
  constructor() { this.volume = 0.45; this.ctx = null; this.listener = { x: 0, z: 0 }; this.steps = new Map(); }
  async start() {
    if (!this.ctx) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return;
      this.ctx = new Context();
      this.master = this.ctx.createGain(); this.master.gain.value = this.volume; this.master.connect(this.ctx.destination);
      const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 3, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < data.length; i++) { last = (last + Math.random() * 0.04 - 0.02) / 1.025; data[i] = last * 3; }
      const noise = this.ctx.createBufferSource(); noise.buffer = buffer; noise.loop = true;
      const filter = this.ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 400;
      const gain = this.ctx.createGain(); gain.gain.value = 0.13;
      noise.connect(filter); filter.connect(gain); gain.connect(this.master); noise.start();
      this.drone = this.ctx.createOscillator(); this.drone.type = 'sine'; this.drone.frequency.value = 43;
      const droneGain = this.ctx.createGain(); droneGain.gain.value = 0.055; this.drone.connect(droneGain); droneGain.connect(this.master); this.drone.start();
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }
  setVolume(value) { this.volume = value; if (this.master) this.master.gain.setTargetAtTime(value, this.ctx.currentTime, 0.1); }
  tone(frequency, duration, volume = 0.15, type = 'sine', slide = 0) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const osc = this.ctx.createOscillator(), gain = this.ctx.createGain(), now = this.ctx.currentTime;
    osc.type = type; osc.frequency.setValueAtTime(frequency, now); osc.frequency.exponentialRampToValueAtTime(Math.max(20, frequency + slide), now + duration);
    gain.gain.setValueAtTime(volume, now); gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain); gain.connect(this.master); osc.start(); osc.stop(now + duration);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  }
  noise(duration, volume, cutoff, position) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const attenuation = position ? Math.max(0, 1 - Math.hypot(position.x - this.listener.x, position.z - this.listener.z) / 55) : 1;
    if (attenuation < 0.01) return;
    const source = this.ctx.createBufferSource(), filter = this.ctx.createBiquadFilter(), gain = this.ctx.createGain();
    const buffer = this.ctx.createBuffer(1, Math.ceil(this.ctx.sampleRate * duration), this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    source.buffer = buffer; filter.type = 'lowpass'; filter.frequency.value = cutoff;
    const now = this.ctx.currentTime;
    gain.gain.setValueAtTime(volume * attenuation, now); gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    source.connect(filter); filter.connect(gain);
    let pan;
    if (position && this.ctx.createStereoPanner) { pan = this.ctx.createStereoPanner(); pan.pan.value = Math.max(-0.85, Math.min(0.85, (position.x - this.listener.x) / 20)); gain.connect(pan); pan.connect(this.master); } else gain.connect(this.master);
    source.start(); source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); pan?.disconnect(); };
  }
  movement(state) {
    const now = performance.now();
    const ids = new Set(state.players.map(p => p.id));
    for (const id of this.steps.keys()) if (!ids.has(id)) this.steps.delete(id);
    for (const p of state.players) {
      if (!p.moved || p.dead || Math.hypot(p.x - this.listener.x, p.z - this.listener.z) > (p.vehicle ? 32 : 12)) continue;
      if (now - (this.steps.get(p.id) || 0) < (p.vehicle ? 220 : 390)) continue;
      this.steps.set(p.id, now);
      this.noise(p.vehicle ? 0.24 : 0.065, p.vehicle ? 0.12 : 0.055, p.vehicle ? 190 : 650, p);
    }
  }
  event(event) {
    if (event.type === 'shot') { this.noise(event.weapon === 'shotgun' ? 0.23 : 0.13, 0.6, event.weapon === 'pistol' ? 2000 : 1400, event); }
    if (event.type === 'kill') this.noise(0.15, 0.14, 600, event);
    if (event.type === 'pickup') { this.tone(640, 0.09, 0.07); setTimeout(() => this.tone(960, 0.14, 0.05), 80); }
    if (event.type === 'power' || event.type === 'stage') { this.tone(120, 1.3, 0.09, 'sine', 300); setTimeout(() => this.tone(480, 0.7, 0.06), 250); }
    if (event.type === 'bite' || event.type === 'turn') this.tone(90, 0.7, 0.14, 'sawtooth', -60);
  }
}
