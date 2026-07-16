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
  onFriendRequest?: (data: { fromUserId: string; fromUsername: string }) => void;
  onFriendAccepted?: (data: { userId: string }) => void;
  onSessionKick?: (data: { message: string }) => void;
  onTopic?: (data: { text: string; category: string }) => void;
  onRoomError?: (data: { message: string }) => void;
  onPartnerDisconnected?: () => void;
  onPartnerRejoined?: () => void;
}

export interface SignalEvents {
  onOffer: (data: { sdp: RTCSessionDescriptionInit }) => void;
  onAnswer: (data: { sdp: RTCSessionDescriptionInit }) => void;
  onIce: (data: { candidate: RTCIceCandidateInit }) => void;
}

export interface UseSocketReturn {
  isConnected: boolean;
  socketRef: React.MutableRefObject<Socket | null>;
  joinMatch: (userId: string, username: string, tags?: string[], nativeLang?: string, targetLang?: string) => void;
  cancelMatch: (userId: string) => void;
  joinRoom: (roomId: string, userId: string) => void;
  sendOffer: (roomId: string, sdp: RTCSessionDescriptionInit) => void;
  sendAnswer: (roomId: string, sdp: RTCSessionDescriptionInit) => void;
  sendIce: (roomId: string, candidate: RTCIceCandidateInit) => void;
  leaveRoom: (roomId: string) => void;
  sendFriendRequest: (fromUserId: string, fromUsername: string, toUserId: string) => void;
  sendFriendAccept: (fromUserId: string, toUserId: string) => void;
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
    socket.on("partner:disconnected", () => matchEventsRef.current.onPartnerDisconnected?.());
    socket.on("partner:rejoined", () => matchEventsRef.current.onPartnerRejoined?.());
    socket.on("room:ready", () => matchEventsRef.current.onReady());
    socket.on("room:error", (data) => matchEventsRef.current.onRoomError?.(data));

    socket.on("signal:offer", (data) => signalEventsRef.current.onOffer(data));
    socket.on("signal:answer", (data) => signalEventsRef.current.onAnswer(data));
    socket.on("signal:ice", (data) => signalEventsRef.current.onIce(data));

    socket.on("friend:request", (data) => matchEventsRef.current.onFriendRequest?.(data));
    socket.on("friend:accepted", (data) => matchEventsRef.current.onFriendAccepted?.(data));
    socket.on("session:kick", (data) => matchEventsRef.current.onSessionKick?.(data));
    socket.on("match:topic", (data) => matchEventsRef.current.onTopic?.(data));

    socketRef.current = socket;

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  const joinMatch = useCallback((userId: string, username: string, tags?: string[], nativeLang?: string, targetLang?: string) => {
    socketRef.current?.emit("match:join", {
      userId, username,
      tags: tags ?? [],
      nativeLang: nativeLang ?? "",
      targetLang: targetLang ?? "",
    });
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

  const sendFriendRequest = useCallback((fromUserId: string, fromUsername: string, toUserId: string) => {
    socketRef.current?.emit("friend:request", { fromUserId, fromUsername, toUserId });
  }, []);

  const sendFriendAccept = useCallback((fromUserId: string, toUserId: string) => {
    socketRef.current?.emit("friend:accept", { fromUserId, toUserId });
  }, []);

  return {
    isConnected,
    socketRef,
    joinMatch,
    cancelMatch,
    joinRoom,
    sendOffer,
    sendAnswer,
    sendIce,
    leaveRoom,
    sendFriendRequest,
    sendFriendAccept,
  };
}
