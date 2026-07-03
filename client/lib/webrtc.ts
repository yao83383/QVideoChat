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

export function addAudioTrack(pc: RTCPeerConnection, stream: MediaStream): void {
  stream.getAudioTracks().forEach((track) => {
    pc.addTrack(track, stream);
  });
  pc.getTransceivers().forEach((t) => {
    if (t.receiver.track.kind === "audio") {
      t.direction = "sendrecv";
    }
  });
}

export function onRemoteStream(
  pc: RTCPeerConnection,
  callback: (stream: MediaStream) => void,
): void {
  pc.ontrack = (event) => {
    console.log("[webrtc] ontrack kind=", event.track.kind, "streams=", event.streams.length);
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
  const offer = await pc.createOffer({ offerToReceiveAudio: true });
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
