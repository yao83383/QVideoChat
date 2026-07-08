const STUN_SERVERS = {
  iceServers: [
    { urls: ["stun:8.140.249.127:3478", "turn:8.140.249.127:3478"], username: "turn", credential: "turn123456" },
    { urls: "stun:stun.miwifi.com:3478" },
    { urls: "stun:stun.l.google.com:19302" },
  ],
};

export function createPeerConnection(): RTCPeerConnection {
  return new RTCPeerConnection(STUN_SERVERS);
}

export function createDataChannel(pc: RTCPeerConnection, label = "blendshape"): RTCDataChannel {
  return pc.createDataChannel(label, {
    ordered: true,
    maxRetransmits: 0,
  });
}

export async function getAudioStream(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
}

export async function addAudioTrack(pc: RTCPeerConnection, stream: MediaStream): Promise<void> {
  const tracks = stream.getAudioTracks();
  console.log("[webrtc] addAudioTrack: local audio tracks=", tracks.map((t) => ({
    id: t.id, enabled: t.enabled, muted: t.muted, readyState: t.readyState, label: t.label,
  })));
  const track = tracks[0];
  if (!track) {
    console.warn("[webrtc] addAudioTrack: no local audio track!");
    return;
  }
  const audioTx = pc.getTransceivers().find(
    (t) => t.receiver.track?.kind === "audio" && !t.sender.track,
  );
  if (audioTx) {
    try {
      await audioTx.sender.replaceTrack(track);
      console.log("[webrtc] replaceTrack -> pre-created transceiver, direction=", audioTx.direction, "sender.track=", audioTx.sender.track?.id);
    } catch (e) {
      console.warn("[webrtc] replaceTrack failed:", e);
    }
    audioTx.direction = "sendrecv";
  } else {
    pc.addTrack(track, stream);
    console.log("[webrtc] addTrack -> new transceiver");
  }
  logTransceivers(pc, "after addAudioTrack");
}

export function ensureAudioTransceiver(pc: RTCPeerConnection): void {
  if (pc.getTransceivers().some((t) => t.receiver.track?.kind === "audio")) return;
  pc.addTransceiver("audio", { direction: "sendrecv" });
  console.log("[webrtc] pre-created audio transceiver (sendrecv)");
}

export function logTransceivers(pc: RTCPeerConnection, tag: string): void {
  const rows = pc.getTransceivers().map((t, i) => ({
    i,
    mid: t.mid,
    kind: t.receiver.track?.kind ?? t.sender.track?.kind ?? "?",
    direction: t.direction,
    currentDirection: t.currentDirection,
    hasSenderTrack: !!t.sender.track,
    hasReceiverTrack: !!t.receiver.track,
  }));
  console.log(`[webrtc] transceivers (${tag}):`, rows);
}

export function onRemoteStream(
  pc: RTCPeerConnection,
  callback: (stream: MediaStream) => void,
): void {
  pc.ontrack = (event) => {
    if (event.track.kind !== "audio") return;
    const t = event.track;
    console.log("[webrtc] ontrack audio id=", t.id, "muted=", t.muted, "enabled=", t.enabled, "readyState=", t.readyState, "streams=", event.streams.length);
    t.onunmute = () => console.log("[webrtc] remote audio unmuted (packets flowing)", t.id);
    t.onmute = () => console.log("[webrtc] remote audio muted (packet stall)", t.id);
    t.onended = () => console.log("[webrtc] remote audio ended", t.id);
    const stream = event.streams[0] || new MediaStream([event.track]);
    callback(stream);
  };
}

export function onIceCandidate(
  pc: RTCPeerConnection,
  callback: (candidate: RTCIceCandidateInit) => void,
): void {
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      callback(event.candidate.toJSON());
    }
  };
}

export async function createOffer(pc: RTCPeerConnection): Promise<RTCSessionDescriptionInit> {
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  return pc.localDescription!.toJSON();
}

export async function createAnswer(pc: RTCPeerConnection): Promise<RTCSessionDescriptionInit> {
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  return pc.localDescription!.toJSON();
}

export async function handleOffer(
  pc: RTCPeerConnection,
  sdp: RTCSessionDescriptionInit,
): Promise<RTCSessionDescriptionInit> {
  await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  return createAnswer(pc);
}

export async function handleAnswer(
  pc: RTCPeerConnection,
  sdp: RTCSessionDescriptionInit,
): Promise<void> {
  await pc.setRemoteDescription(new RTCSessionDescription(sdp));
}

export async function addIceCandidate(
  pc: RTCPeerConnection,
  candidate: RTCIceCandidateInit,
): Promise<void> {
  await pc.addIceCandidate(new RTCIceCandidate(candidate));
}
