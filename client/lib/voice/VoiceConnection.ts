/**
 * VoiceConnection — a standalone WebRTC audio peer connection.
 *
 * Purpose: keep all audio + PC lifecycle logic in one place, decoupled from
 * DataChannel, face mesh, VRM, or matching. This is the module we invest in
 * long-term for voice (and later video) — the surrounding React app is glue.
 *
 * Design notes:
 * - Uses plain `pc.addTrack(track, stream)` (proven by /audio-test).
 * - Buffers remote ICE until remote description is set.
 * - Exposes `pc` so callers can attach data channels or media video later.
 * - Signalling is injected — the class is transport-agnostic.
 */

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: ["stun:8.140.249.127:3478", "turn:8.140.249.127:3478"], username: "turn", credential: "turn123456" },
  { urls: "stun:stun.miwifi.com:3478" },
  { urls: "stun:stun.l.google.com:19302" },
];

export interface VoiceSignaling {
  sendOffer: (sdp: RTCSessionDescriptionInit) => void;
  sendAnswer: (sdp: RTCSessionDescriptionInit) => void;
  sendIceCandidate: (candidate: RTCIceCandidateInit) => void;
}

export interface VoiceStats {
  packetsSent?: number;
  packetsReceived?: number;
  bytesSent?: number;
  bytesReceived?: number;
  packetsLost?: number;
  pairType?: string;
  remoteTrackMuted?: boolean;
}

export interface VoiceConnectionOptions {
  iceServers?: RTCIceServer[];
  signaling: VoiceSignaling;
  onLocalStream?: (stream: MediaStream) => void;
  onRemoteStream?: (stream: MediaStream) => void;
  onConnectionState?: (state: RTCPeerConnectionState) => void;
  onIceState?: (state: RTCIceConnectionState) => void;
  onStats?: (stats: VoiceStats) => void;
  onError?: (err: Error) => void;
  log?: (msg: string) => void;
  statsIntervalMs?: number;
}

export class VoiceConnection {
  readonly pc: RTCPeerConnection;
  private localStream: MediaStream | null = null;
  private remoteDescSet = false;
  private pendingIce: RTCIceCandidateInit[] = [];
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(private readonly opts: VoiceConnectionOptions) {
    this.pc = new RTCPeerConnection({
      iceServers: opts.iceServers ?? DEFAULT_ICE_SERVERS,
    });
    this.setupPc();
  }

  private log(msg: string) {
    this.opts.log?.(msg);
  }

  private setupPc() {
    this.pc.oniceconnectionstatechange = () => {
      this.log(`ice=${this.pc.iceConnectionState}`);
      this.opts.onIceState?.(this.pc.iceConnectionState);
    };
    this.pc.onconnectionstatechange = () => {
      this.log(`conn=${this.pc.connectionState}`);
      this.opts.onConnectionState?.(this.pc.connectionState);
      if (this.pc.connectionState === "connected" && this.opts.onStats) {
        this.startStatsPolling();
      }
      if (this.pc.connectionState === "closed" || this.pc.connectionState === "failed") {
        this.stopStatsPolling();
      }
    };
    this.pc.onicecandidate = (e) => {
      if (e.candidate) this.opts.signaling.sendIceCandidate(e.candidate.toJSON());
    };
    this.pc.ontrack = (e) => {
      if (e.track.kind !== "audio") return;
      this.log(`ontrack audio id=${e.track.id.slice(0, 8)} muted=${e.track.muted} streams=${e.streams.length}`);
      const stream = e.streams[0] || new MediaStream([e.track]);
      e.track.onunmute = () => this.log(">>> REMOTE UNMUTED (packets flowing) <<<");
      e.track.onmute = () => this.log(">>> REMOTE MUTED <<<");
      this.opts.onRemoteStream?.(stream);
    };
  }

  /**
   * Acquire mic + attach track BEFORE any signaling begins.
   * Callers should await this and only then start signaling.
   */
  async attachMic(constraints?: MediaTrackConstraints): Promise<MediaStream> {
    if (this.closed) throw new Error("VoiceConnection is closed");
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: constraints ?? { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    if (this.closed) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error("VoiceConnection closed during getUserMedia");
    }
    this.localStream = stream;
    for (const track of stream.getAudioTracks()) {
      this.pc.addTrack(track, stream);
      this.log(`addTrack id=${track.id.slice(0, 8)} enabled=${track.enabled} muted=${track.muted}`);
    }
    this.opts.onLocalStream?.(stream);
    return stream;
  }

  async createAndSendOffer(): Promise<void> {
    if (this.closed) return;
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.log("sent offer");
    this.opts.signaling.sendOffer(this.pc.localDescription!.toJSON());
  }

  async handleRemoteOffer(sdp: RTCSessionDescriptionInit): Promise<void> {
    if (this.closed) return;
    await this.pc.setRemoteDescription(new RTCSessionDescription(sdp));
    this.remoteDescSet = true;
    this.log("setRemote(offer)");
    await this.flushPendingIce();
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    this.log("sent answer");
    this.opts.signaling.sendAnswer(this.pc.localDescription!.toJSON());
  }

  async handleRemoteAnswer(sdp: RTCSessionDescriptionInit): Promise<void> {
    if (this.closed) return;
    await this.pc.setRemoteDescription(new RTCSessionDescription(sdp));
    this.remoteDescSet = true;
    this.log("setRemote(answer)");
    await this.flushPendingIce();
  }

  async handleRemoteIce(candidate: RTCIceCandidateInit): Promise<void> {
    if (this.closed) return;
    if (!this.remoteDescSet) {
      this.pendingIce.push(candidate);
      return;
    }
    try {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
      this.log(`addIceCandidate failed: ${(e as Error)?.message}`);
    }
  }

  private async flushPendingIce() {
    const pending = this.pendingIce;
    this.pendingIce = [];
    for (const c of pending) {
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(c));
      } catch { /* ignore stale */ }
    }
  }

  setMicEnabled(enabled: boolean): void {
    this.localStream?.getAudioTracks().forEach((t) => { t.enabled = enabled; });
  }

  isMicEnabled(): boolean {
    return this.localStream?.getAudioTracks()[0]?.enabled ?? false;
  }

  getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  private startStatsPolling() {
    if (this.statsTimer) return;
    const interval = this.opts.statsIntervalMs ?? 5000;
    this.statsTimer = setInterval(async () => {
      if (this.pc.connectionState !== "connected" || this.closed) return;
      try {
        const stats = await this.pc.getStats();
        const summary: VoiceStats = {};
        stats.forEach((s: any) => {
          if (s.type === "outbound-rtp" && s.kind === "audio") {
            summary.packetsSent = s.packetsSent;
            summary.bytesSent = s.bytesSent;
          }
          if (s.type === "inbound-rtp" && s.kind === "audio") {
            summary.packetsReceived = s.packetsReceived;
            summary.bytesReceived = s.bytesReceived;
            summary.packetsLost = s.packetsLost;
          }
          if (s.type === "candidate-pair" && s.nominated && s.state === "succeeded") {
            const l = stats.get(s.localCandidateId) as any;
            const r = stats.get(s.remoteCandidateId) as any;
            summary.pairType = `${l?.candidateType ?? "?"}/${r?.candidateType ?? "?"}`;
          }
        });
        const recv = this.pc.getReceivers().find((r) => r.track.kind === "audio");
        if (recv) summary.remoteTrackMuted = recv.track.muted;
        this.opts.onStats?.(summary);
      } catch { /* ignore */ }
    }, interval);
  }

  private stopStatsPolling() {
    if (this.statsTimer) { clearInterval(this.statsTimer); this.statsTimer = null; }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.stopStatsPolling();
    try { this.pc.close(); } catch { /* ignore */ }
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    this.remoteDescSet = false;
    this.pendingIce = [];
  }
}
