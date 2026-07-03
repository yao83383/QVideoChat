"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import type { BlendshapeFrame } from "./useFaceMesh";
import {
  createPeerConnection,
  createDataChannel,
  getAudioStream,
  addAudioTrack,
  onRemoteStream,
  onIceCandidate,
  createOffer,
  createAnswer,
  handleAnswer as doHandleAnswer,
  addIceCandidate,
} from "@/lib/webrtc";

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
  initConnection: (asInitiator: boolean) => Promise<void>;
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
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
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
    pcRef.current?.close(); pcRef.current = null;
    audioStreamRef.current?.getTracks().forEach((t) => t.stop());
    audioStreamRef.current = null;
    remoteBlendshapeRef.current = null;
    setRemoteAudioStream(null); setLocalAudioStream(null); setIsConnected(false); setIsConnecting(false); setIceState("idle");
  }, []);

  const initConnection = useCallback(async (asInitiator: boolean) => {
    try {
      setIsConnecting(true);
      setError(null);
      cleanup();

      const pc = createPeerConnection();
      pcRef.current = pc;

      pc.oniceconnectionstatechange = () => setIceState(pc.iceConnectionState);
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
          setError(`连接状态: ${pc.connectionState}`);
        }
      };

      onIceCandidate(pc, (c) => signalingRef.current.onIceCandidate(c));
      onRemoteStream(pc, (stream) => { setRemoteAudioStream(stream); });

      if (!asInitiator) {
        pc.ondatachannel = (event) => { setupDataChannel(event.channel); };
      }

      const audioStream = await getAudioStream();
      audioStreamRef.current = audioStream;
      setLocalAudioStream(audioStream);
      addAudioTrack(pc, audioStream);

      if (asInitiator) {
        const dc = createDataChannel(pc);
        setupDataChannel(dc);
        const offer = await createOffer(pc);
        signalingRef.current.onOffer(offer);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "连接失败");
      setIsConnecting(false); cleanup();
    }
  }, [cleanup, setupDataChannel]);

  const startAsInitiator = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc) { setError("PC not ready"); return; }
    try {
      const dc = createDataChannel(pc);
      setupDataChannel(dc);
      const offer = await createOffer(pc);
      signalingRef.current.onOffer(offer);
    } catch (e) {
      setError(e instanceof Error ? e.message : "发送 Offer 失败");
    }
  }, [setupDataChannel]);

  const handleIncomingOffer = useCallback(async (sdp: RTCSessionDescriptionInit) => {
    const pc = pcRef.current;
    if (!pc) return;
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      // Reinforce audio transceiver direction for the answer
      pc.getTransceivers().forEach((t) => {
        if (t.receiver.track.kind === "audio") {
          t.direction = "sendrecv";
        }
      });
      const answer = await createAnswer(pc);
      signalingRef.current.onAnswer(answer);
    } catch (e) {
      setError(e instanceof Error ? e.message : "处理 Offer 失败");
    }
  }, []);

  const handleIncomingAnswer = useCallback(async (sdp: RTCSessionDescriptionInit) => {
    const pc = pcRef.current;
    if (!pc) return;
    try { await doHandleAnswer(pc, sdp); }
    catch (e) { setError(e instanceof Error ? e.message : "处理 Answer 失败"); }
  }, []);

  const handleIncomingIce = useCallback(async (candidate: RTCIceCandidateInit) => {
    const pc = pcRef.current;
    if (!pc) return;
    try { await addIceCandidate(pc, candidate); } catch { /* skip */ }
  }, []);

  const toggleMic = useCallback(() => {
    const stream = audioStreamRef.current;
    if (!stream) return;
    const tracks = stream.getAudioTracks();
    const newState = !isMicOn;
    tracks.forEach((t) => { t.enabled = newState; });
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
