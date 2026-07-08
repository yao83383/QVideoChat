"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import type { BlendshapeFrame } from "./useFaceMesh";
import { VoiceConnection } from "@/lib/voice/VoiceConnection";

interface SignalingEvents {
  onOffer: (sdp: RTCSessionDescriptionInit) => void;
  onAnswer: (sdp: RTCSessionDescriptionInit) => void;
  onIceCandidate: (candidate: RTCIceCandidateInit) => void;
}

export interface UsePeerReturn {
  remoteBlendshapeRef: React.MutableRefObject<BlendshapeFrame | null>;
  remoteAudioStream: MediaStream | null;
  localAudioStream: MediaStream | null;
  isConnected: boolean;
  isConnecting: boolean;
  iceState: string;
  error: string | null;
  isMicOn: boolean;
  toggleMic: () => void;
  /** Initializes the voice + PC + data channel handlers. Await this before any signalling. */
  initConnection: (asInitiator: boolean) => Promise<void>;
  /** Called by the initiator once the room is ready to send the offer. */
  startAsInitiator: () => Promise<void>;
  handleIncomingOffer: (sdp: RTCSessionDescriptionInit) => Promise<void>;
  handleIncomingAnswer: (sdp: RTCSessionDescriptionInit) => Promise<void>;
  handleIncomingIce: (candidate: RTCIceCandidateInit) => Promise<void>;
  disconnect: () => void;
}

/**
 * usePeer — combines VoiceConnection (audio) with a blendshape DataChannel.
 * All the voice-related complexity lives in VoiceConnection.
 */
export function usePeer(
  blendshapeRef: React.MutableRefObject<BlendshapeFrame | null>,
  signaling: SignalingEvents,
): UsePeerReturn {
  const voiceRef = useRef<VoiceConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const remoteBlendshapeRef = useRef<BlendshapeFrame | null>(null);
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

  const setupDataChannel = useCallback((dc: RTCDataChannel) => {
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

  const cleanup = useCallback(() => {
    if (sendTimerRef.current) { clearInterval(sendTimerRef.current); sendTimerRef.current = null; }
    dcRef.current?.close(); dcRef.current = null;
    voiceRef.current?.close(); voiceRef.current = null;
    remoteBlendshapeRef.current = null;
    setRemoteAudioStream(null); setLocalAudioStream(null); setIsConnected(false); setIsConnecting(false); setIceState("idle");
  }, []);

  /**
   * Order matters for correct signalling: acquire mic + attach BEFORE any
   * `join` message goes out, so the server can't emit `ready` until both
   * peers already have their local audio track on the PC.
   */
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
        // Optional stats surface — dev-time console only.
        // eslint-disable-next-line no-console
        console.log("[voice.stats]", JSON.stringify(st));
      },
      log: (msg) => console.log("[voice]", msg),
    });
    voiceRef.current = voice;

    // Answerer must have ondatachannel hooked BEFORE receiving the remote offer.
    if (!asInitiator) {
      voice.pc.ondatachannel = (event) => setupDataChannel(event.channel);
    }

    try {
      await voice.attachMic();
    } catch (e) {
      setError(e instanceof Error ? e.message : "麦克风获取失败");
      cleanup();
      throw e;
    }
  }, [cleanup, setupDataChannel]);

  const startAsInitiator = useCallback(async () => {
    const voice = voiceRef.current;
    if (!voice) { setError("Voice not ready"); return; }
    // Guard against double-invoke: if we already have a local offer, skip.
    if (voice.pc.localDescription) return;
    try {
      const dc = voice.pc.createDataChannel("blendshape", { ordered: true, maxRetransmits: 0 });
      setupDataChannel(dc);
      await voice.createAndSendOffer();
    } catch (e) {
      setError(e instanceof Error ? e.message : "发送 Offer 失败");
    }
  }, [setupDataChannel]);

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
  }, [isMicOn]);

  useEffect(() => () => cleanup(), [cleanup]);

  return {
    remoteBlendshapeRef, remoteAudioStream, localAudioStream, isConnected, isConnecting, iceState, error,
    isMicOn, toggleMic,
    initConnection, startAsInitiator,
    handleIncomingOffer, handleIncomingAnswer, handleIncomingIce,
    disconnect: cleanup,
  };
}
