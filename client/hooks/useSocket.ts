"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { io, Socket } from "socket.io-client";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:3001";
const SOCKET_PATH = process.env.NEXT_PUBLIC_SOCKET_PATH || "/socket.io";

export interface MatchEvents {
  onWaiting: () => void;
  onFound: (data: { roomId: string; partner: { userId: string; username: string } }) => void;
  onPartnerLeft: () => void;
  onReady: () => void;
}

export interface SignalEvents {
  onOffer: (data: { sdp: RTCSessionDescriptionInit }) => void;
  onAnswer: (data: { sdp: RTCSessionDescriptionInit }) => void;
  onIce: (data: { candidate: RTCIceCandidateInit }) => void;
}

export interface UseSocketReturn {
  isConnected: boolean;
  joinMatch: (userId: string, username: string) => void;
  cancelMatch: (userId: string) => void;
  joinRoom: (roomId: string, userId: string) => void;
  sendOffer: (roomId: string, sdp: RTCSessionDescriptionInit) => void;
  sendAnswer: (roomId: string, sdp: RTCSessionDescriptionInit) => void;
  sendIce: (roomId: string, candidate: RTCIceCandidateInit) => void;
  leaveRoom: (roomId: string) => void;
}

export function useSocket(
  matchEvents: MatchEvents,
  signalEvents: SignalEvents,
): UseSocketReturn {
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const matchEventsRef = useRef(matchEvents);
  const signalEventsRef = useRef(signalEvents);

  matchEventsRef.current = matchEvents;
  signalEventsRef.current = signalEvents;

  useEffect(() => {
    const socket = io(SERVER_URL, {
      path: SOCKET_PATH,
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 1000,
    });

    socket.on("connect", () => setIsConnected(true));
    socket.on("disconnect", () => setIsConnected(false));

    socket.on("match:waiting", () => matchEventsRef.current.onWaiting());
    socket.on("match:found", (data) => matchEventsRef.current.onFound(data));
    socket.on("partner:left", () => matchEventsRef.current.onPartnerLeft());
    socket.on("room:ready", () => matchEventsRef.current.onReady());

    socket.on("signal:offer", (data) => signalEventsRef.current.onOffer(data));
    socket.on("signal:answer", (data) => signalEventsRef.current.onAnswer(data));
    socket.on("signal:ice", (data) => signalEventsRef.current.onIce(data));

    socketRef.current = socket;

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  const joinMatch = useCallback((userId: string, username: string) => {
    socketRef.current?.emit("match:join", { userId, username });
  }, []);

  const cancelMatch = useCallback((userId: string) => {
    socketRef.current?.emit("match:cancel", { userId });
  }, []);

  const joinRoom = useCallback((roomId: string, userId: string) => {
    socketRef.current?.emit("room:join", { roomId, userId });
  }, []);

  const sendOffer = useCallback((roomId: string, sdp: RTCSessionDescriptionInit) => {
    socketRef.current?.emit("signal:offer", { roomId, sdp });
  }, []);

  const sendAnswer = useCallback((roomId: string, sdp: RTCSessionDescriptionInit) => {
    socketRef.current?.emit("signal:answer", { roomId, sdp });
  }, []);

  const sendIce = useCallback((roomId: string, candidate: RTCIceCandidateInit) => {
    socketRef.current?.emit("signal:ice", { roomId, candidate });
  }, []);

  const leaveRoom = useCallback((roomId: string) => {
    socketRef.current?.emit("room:leave", { roomId });
  }, []);

  return {
    isConnected,
    joinMatch,
    cancelMatch,
    joinRoom,
    sendOffer,
    sendAnswer,
    sendIce,
    leaveRoom,
  };
}
