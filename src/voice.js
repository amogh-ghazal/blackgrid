export class VoiceRoom {
  constructor({ selfId, send, onStatus }) {
    this.selfId = selfId;
    this.send = send;
    this.onStatus = onStatus;
    this.stream = null;
    this.peers = new Map();
    this.active = false;
  }

  async enable(players) {
    if (this.active) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) throw new Error('Voice chat is not available in this browser.');
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    for (const track of this.stream.getAudioTracks()) track.enabled = false;
    this.active = true;
    this.sync(players);
    this.send({ type: 'voice-ready' });
    this.onStatus('MICROPHONE READY · TAP MIC TO SPEAK');
  }

  sync(players) {
    if (!this.active) return;
    for (const player of players) {
      if (player.bot || player.id === this.selfId) continue;
      this.ensurePeer(player.id, player.name, this.selfId.localeCompare(player.id) < 0).catch(() => {});
    }
    const allowed = new Set(players.filter(player => !player.bot && player.id !== this.selfId).map(player => player.id));
    for (const [id, peer] of this.peers) if (!allowed.has(id)) { peer.connection.close(); peer.audio.remove(); this.peers.delete(id); }
  }

  async ensurePeer(id, name, offerer = false) {
    if (!this.active || this.peers.has(id)) return;
    const connection = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    const audio = document.createElement('audio'); audio.autoplay = true; audio.playsInline = true; audio.dataset.player = id;
    document.getElementById('voice-audio').append(audio);
    const entry = { connection, audio, name, candidates: [] };
    this.peers.set(id, entry);
    for (const track of this.stream.getAudioTracks()) connection.addTrack(track, this.stream);
    connection.onicecandidate = event => { if (event.candidate) this.send({ type: 'signal', to: id, signal: { candidate: event.candidate.toJSON() } }); };
    connection.ontrack = event => { audio.srcObject = event.streams[0]; audio.play().catch(() => this.onStatus('TAP TO ALLOW INCOMING AUDIO')); };
    connection.onconnectionstatechange = () => {
      if (connection.connectionState === 'connected') this.onStatus(`VOICE CONNECTED · ${this.peers.size} PEER${this.peers.size === 1 ? '' : 'S'}`);
      if (connection.connectionState === 'failed') this.onStatus('VOICE LINK FAILED · NETWORK MAY NEED A RELAY');
    };
    if (offerer) {
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      this.send({ type: 'signal', to: id, signal: { description: { type: connection.localDescription.type, sdp: connection.localDescription.sdp } } });
    }
  }

  async signal(from, signal) {
    if (!this.active || !signal || typeof signal !== 'object') return;
    await this.ensurePeer(from, 'Crew member', this.selfId.localeCompare(from) < 0);
    const peer = this.peers.get(from);
    if (!peer) return;
    if (signal.description) {
      await peer.connection.setRemoteDescription(signal.description);
      for (const candidate of peer.candidates.splice(0)) await peer.connection.addIceCandidate(candidate);
      if (signal.description.type === 'offer') {
        const answer = await peer.connection.createAnswer();
        await peer.connection.setLocalDescription(answer);
        this.send({ type: 'signal', to: from, signal: { description: { type: peer.connection.localDescription.type, sdp: peer.connection.localDescription.sdp } } });
      }
    } else if (signal.candidate) {
      if (peer.connection.remoteDescription) await peer.connection.addIceCandidate(signal.candidate);
      else peer.candidates.push(signal.candidate);
    }
  }

  async ready(from, name = 'Crew member') {
    if (!this.active || this.selfId.localeCompare(from) >= 0) return;
    const old = this.peers.get(from);
    if (old) { old.connection.close(); old.audio.remove(); this.peers.delete(from); }
    await this.ensurePeer(from, name, true);
  }

  removePeer(id) {
    const peer = this.peers.get(id);
    if (!peer) return;
    peer.connection.close(); peer.audio.remove(); this.peers.delete(id);
  }

  setTalking(enabled) { if (this.stream) for (const track of this.stream.getAudioTracks()) track.enabled = enabled; }

  close() {
    this.setTalking(false);
    for (const peer of this.peers.values()) { peer.connection.close(); peer.audio.remove(); }
    this.peers.clear();
    for (const track of this.stream?.getTracks() || []) track.stop();
    this.stream = null; this.active = false;
  }
}
