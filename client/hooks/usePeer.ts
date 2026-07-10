"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import type { BlendshapeFrame } from "./useFaceMesh";
import { VoiceConnection } from "@/lib/voice/VoiceConnection";

interface SignalingEvents {
  onOffer: (sdp: RTCSessionDescriptionInit) => void;
  onAnswer: (sdp: RTCSessionDescriptionInit) => void;
  onIceCandidate: (candidate: RTCIceCandidateInit) => void;
}

export interface TranslationMessage {
  text: string;
  sourceText?: string;
  sourceLang: string;
  targetLang: string;
  isFinal?: boolean;
  /** Sender signals whether they will follow up with a translation.
   *  true  = wait for our translated text (sender is translating locally)
   *  false = we won't translate, receiver should if they can (mobile sender) */
  pendingTranslate?: boolean;
}

export interface UsePeerReturn {
  remoteBlendshapeRef: React.MutableRefObject<BlendshapeFrame | null>;
  remoteTranslationRef: React.MutableRefObject<TranslationMessage | null>;
  remoteAudioStream: MediaStream | null;
  localAudioStream: MediaStream | null;
  isConnected: boolean;
  isConnecting: boolean;
  iceState: string;
  error: string | null;
  isMicOn: boolean;
  /** Remote peer's mic state — surfaced so UI can show a mute badge over their avatar. */
  remoteMicOn: boolean;
  toggleMic: () => void;
  /** Send a translated subtitle to the peer via DataChannel. */
  sendTranslation: (msg: TranslationMessage) => void;
  /** Subscribe to remote subtitle messages. Returns an unsubscribe fn. */
  onRemoteTranslation: (cb: (msg: TranslationMessage) => void) => () => void;
  /** Initializes the voice + PC + data channel handlers. Await this before any signalling. */
  initConnection: (asInitiator: boolean) => Promise<void>;
  /** Called by the initiator once the room is ready to send the offer. */
  startAsInitiator: () => Promise<void>;
  handleIncomingOffer: (sdp: RTCSessionDescriptionInit) => Promise<void>;
  handleIncomingAnswer: (sdp: RTCSessionDescriptionInit) => Promise<void>;
  handleIncomingIce: (candidate: RTCIceCandidateInit) => Promise<void>;
  disconnect: () => void;
}

export function usePeer(
  blendshapeRef: React.MutableRefObject<BlendshapeFrame | null>,
  signaling: SignalingEvents,
): UsePeerReturn {
  const voiceRef = useRef<VoiceConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const translateDcRef = useRef<RTCDataChannel | null>(null);
  const remoteBlendshapeRef = useRef<BlendshapeFrame | null>(null);
  const remoteTranslationRef = useRef<TranslationMessage | null>(null);
  const translationSubsRef = useRef<Set<(msg: TranslationMessage) => void>>(new Set());
  const sendTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const signalingRef = useRef(signaling);
  signalingRef.current = signaling;

  const [remoteAudioStream, setRemoteAudioStream] = useState<MediaStream | null>(null);
  const [localAudioStream, setLocalAudioStream] = useState<MediaStream | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [iceState, setIceState] = useState("idle");
  const [error, setError] = useState<string | null>(null);
  const [isMicOn, setIsMicOn] = useState(true);
  const [remoteMicOn, setRemoteMicOn] = useState(true);
  const isMicOnRef = useRef(isMicOn);
  useEffect(() => { isMicOnRef.current = isMicOn; }, [isMicOn]);

  const setupBlendshapeChannel = useCallback((dc: RTCDataChannel) => {
    dcRef.current = dc;
    dc.onopen = () => {
      setIsConnected(true);
      setIsConnecting(false);
      if (sendTimerRef.current) clearInterval(sendTimerRef.current);
      sendTimerRef.current = setInterval(() => {
        if (dcRef.current?.readyState !== "open") return;
        const data = blendshapeRef.current;
        if (!data) return;
        const filtered: Record<string, number> = {};
        for (const [key, val] of Object.entries(data.values)) {
          if (val > 0.001) filtered[key] = Math.round(val * 1000) / 1000;
        }
        dcRef.current.send(JSON.stringify({ t: data.timestamp, b: filtered }));
      }, 33);
    };
    dc.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.b) {
          remoteBlendshapeRef.current = { timestamp: data.t, values: data.b };
        }
      } catch { /* ignore */ }
    };
  }, [blendshapeRef]);

  const setupTranslationChannel = useCallback((dc: RTCDataChannel) => {
    translateDcRef.current = dc;
    dc.onopen = () => {
      // Announce our current mic state so the peer's UI reflects it right away.
      try {
        dc.send(JSON.stringify({ type: "mic", on: isMicOnRef.current ? 1 : 0 }));
      } catch { /* channel died */ }
    };
    dc.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "mic") {
          setRemoteMicOn(data.on === 1);
          return;
        }
        if (data.text || data.st) {
          const msg: TranslationMessage = {
            text: data.text || "",
            sourceText: data.st || "",
            sourceLang: data.sl || "",
            targetLang: data.tl || "",
            isFinal: data.f !== 0,
            pendingTranslate: data.p === 1,
          };
          remoteTranslationRef.current = msg;
          // Notify subscribers synchronously so nothing is lost between polls.
          for (const cb of translationSubsRef.current) {
            try { cb(msg); } catch { /* subscriber error — swallow */ }
          }
        }
      } catch { /* ignore */ }
    };
  }, []);

  const onRemoteTranslation = useCallback((cb: (msg: TranslationMessage) => void) => {
    translationSubsRef.current.add(cb);
    return () => { translationSubsRef.current.delete(cb); };
  }, []);

  const cleanup = useCallback(() => {
    if (sendTimerRef.current) { clearInterval(sendTimerRef.current); sendTimerRef.current = null; }
    dcRef.current?.close(); dcRef.current = null;
    translateDcRef.current?.close(); translateDcRef.current = null;
    voiceRef.current?.close(); voiceRef.current = null;
    remoteBlendshapeRef.current = null;
    remoteTranslationRef.current = null;
    setRemoteAudioStream(null); setLocalAudioStream(null); setIsConnected(false); setIsConnecting(false); setIceState("idle");
    setRemoteMicOn(true);
  }, []);

  const sendTranslation = useCallback((msg: TranslationMessage) => {
    if (translateDcRef.current?.readyState === "open") {
      translateDcRef.current.send(JSON.stringify({
        text: msg.text,
        st: msg.sourceText || "",
        sl: msg.sourceLang,
        tl: msg.targetLang,
        f: msg.isFinal === false ? 0 : 1,
        p: msg.pendingTranslate ? 1 : 0,
      }));
    }
  }, []);

  const onDataChannel = useCallback((event: RTCDataChannelEvent) => {
    const label = event.channel.label;
    if (label === "translation") {
      setupTranslationChannel(event.channel);
    } else {
      setupBlendshapeChannel(event.channel);
    }
  }, [setupBlendshapeChannel, setupTranslationChannel]);

  const initConnection = useCallback(async (asInitiator: boolean) => {
    cleanup();
    setIsConnecting(true);
    setError(null);

    const voice = new VoiceConnection({
      signaling: {
        sendOffer: (sdp) => signalingRef.current.onOffer(sdp),
        sendAnswer: (sdp) => signalingRef.current.onAnswer(sdp),
        sendIceCandidate: (c) => signalingRef.current.onIceCandidate(c),
      },
      onLocalStream: (s) => setLocalAudioStream(s),
      onRemoteStream: (s) => setRemoteAudioStream(s),
      onConnectionState: (s) => {
        if (s === "failed" || s === "disconnected") setError(`连接状态: ${s}`);
      },
      onIceState: (s) => setIceState(s),
      onStats: (st) => {
        // Only log stats if something looks off — routine heartbeats drown out
        // ASR/worker debug logs during subtitle troubleshooting.
        if ((st.packetsLost ?? 0) > 0 || st.remoteTrackMuted) {
          console.warn("[voice.stats]", JSON.stringify(st));
        }
      },
      log: (msg) => console.log("[voice]", msg),
    });
    voiceRef.current = voice;

    // Answerer must hook ondatachannel BEFORE receiving the remote offer.
    if (!asInitiator) {
      voice.pc.ondatachannel = onDataChannel;
    }

    try {
      await voice.attachMic();
    } catch (e) {
      setError(e instanceof Error ? e.message : "麦克风获取失败");
      cleanup();
      throw e;
    }
  }, [cleanup, onDataChannel]);

  const startAsInitiator = useCallback(async () => {
    const voice = voiceRef.current;
    if (!voice) { setError("Voice not ready"); return; }
    if (voice.pc.localDescription) return;
    try {
      // Create both data channels before sending offer (must be done before setLocalDescription)
      const bsDc = voice.pc.createDataChannel("blendshape", { ordered: true, maxRetransmits: 0 });
      setupBlendshapeChannel(bsDc);

      const trDc = voice.pc.createDataChannel("translation", { ordered: true });
      setupTranslationChannel(trDc);

      await voice.createAndSendOffer();
    } catch (e) {
      setError(e instanceof Error ? e.message : "发送 Offer 失败");
    }
  }, [setupBlendshapeChannel, setupTranslationChannel]);

  const handleIncomingOffer = useCallback(async (sdp: RTCSessionDescriptionInit) => {
    const voice = voiceRef.current;
    if (!voice) return;
    try {
      await voice.handleRemoteOffer(sdp);
    } catch (e) {
      setError(e instanceof Error ? e.message : "处理 Offer 失败");
    }
  }, []);

  const handleIncomingAnswer = useCallback(async (sdp: RTCSessionDescriptionInit) => {
    const voice = voiceRef.current;
    if (!voice) return;
    try {
      await voice.handleRemoteAnswer(sdp);
    } catch (e) {
      setError(e instanceof Error ? e.message : "处理 Answer 失败");
    }
  }, []);

  const handleIncomingIce = useCallback(async (candidate: RTCIceCandidateInit) => {
    const voice = voiceRef.current;
    if (!voice) return;
    await voice.handleRemoteIce(candidate);
  }, []);

  const toggleMic = useCallback(() => {
    const voice = voiceRef.current;
    if (!voice) return;
    const newState = !isMicOn;
    voice.setMicEnabled(newState);
    setIsMicOn(newState);
    // Broadcast mic state so peer's UI reflects it.
    if (translateDcRef.current?.readyState === "open") {
      try {
        translateDcRef.current.send(JSON.stringify({ type: "mic", on: newState ? 1 : 0 }));
      } catch { /* channel died */ }
    }
  }, [isMicOn]);

  useEffect(() => () => cleanup(), [cleanup]);

  return {
    remoteBlendshapeRef, remoteTranslationRef, remoteAudioStream, localAudioStream,
    isConnected, isConnecting, iceState, error,
    isMicOn, remoteMicOn, toggleMic, sendTranslation, onRemoteTranslation,
    initConnection, startAsInitiator,
    handleIncomingOffer, handleIncomingAnswer, handleIncomingIce,
    disconnect: cleanup,
  };
}
