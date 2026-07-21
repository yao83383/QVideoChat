"use client";

import { useRef, useCallback, useEffect } from "react";
import { Socket } from "socket.io-client";
import { useSocketConnection } from "@/contexts/SocketContext";

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

/**
 * Consume the app-wide socket (see `contexts/SocketContext.tsx`) and hook
 * up match / signal handlers. Historical note: this hook used to own the
 * socket lifecycle (`io()` on mount, `disconnect()` on unmount). That was
 * moved to the SocketProvider so the connection can outlive route changes
 * — presence needs to persist while the user browses. The consumer API
 * (this file's exports) is unchanged so callers didn't need updating.
 *
 * The `matchEvents` / `signalEvents` bags are stored in refs and re-read
 * on every socket event, which means callers can pass fresh closures each
 * render without churning the `socket.on(...)` subscriptions.
 */
export function useSocket(
  matchEvents: MatchEvents,
  signalEvents: SignalEvents,
): UseSocketReturn {
  const { socket, isConnected } = useSocketConnection();

  // Mirror the current socket into a ref so the returned emit helpers
  // (memoized with `[]`) always see the latest socket after the provider
  // rebuilds it (login/logout, storage listener path).
  const socketRef = useRef<Socket | null>(null);
  socketRef.current = socket;

  const matchEventsRef = useRef(matchEvents);
  const signalEventsRef = useRef(signalEvents);
  matchEventsRef.current = matchEvents;
  signalEventsRef.current = signalEvents;

  useEffect(() => {
    if (!socket) return;

    const onWaiting = () => matchEventsRef.current.onWaiting();
    const onFound = (data: Parameters<MatchEvents["onFound"]>[0]) =>
      matchEventsRef.current.onFound(data);
    const onPartnerLeft = () => matchEventsRef.current.onPartnerLeft();
    const onPartnerDisconnected = () => matchEventsRef.current.onPartnerDisconnected?.();
    const onPartnerRejoined = () => matchEventsRef.current.onPartnerRejoined?.();
    const onReady = () => matchEventsRef.current.onReady();
    const onRoomError = (data: { message: string }) =>
      matchEventsRef.current.onRoomError?.(data);

    const onOffer = (data: { sdp: RTCSessionDescriptionInit }) =>
      signalEventsRef.current.onOffer(data);
    const onAnswer = (data: { sdp: RTCSessionDescriptionInit }) =>
      signalEventsRef.current.onAnswer(data);
    const onIce = (data: { candidate: RTCIceCandidateInit }) =>
      signalEventsRef.current.onIce(data);

    const onFriendRequest = (data: { fromUserId: string; fromUsername: string }) =>
      matchEventsRef.current.onFriendRequest?.(data);
    const onFriendAccepted = (data: { userId: string }) =>
      matchEventsRef.current.onFriendAccepted?.(data);
    const onSessionKick = (data: { message: string }) =>
      matchEventsRef.current.onSessionKick?.(data);
    const onTopic = (data: { text: string; category: string }) =>
      matchEventsRef.current.onTopic?.(data);

    socket.on("match:waiting", onWaiting);
    socket.on("match:found", onFound);
    socket.on("partner:left", onPartnerLeft);
    socket.on("partner:disconnected", onPartnerDisconnected);
    socket.on("partner:rejoined", onPartnerRejoined);
    socket.on("room:ready", onReady);
    socket.on("room:error", onRoomError);

    socket.on("signal:offer", onOffer);
    socket.on("signal:answer", onAnswer);
    socket.on("signal:ice", onIce);

    socket.on("friend:request", onFriendRequest);
    socket.on("friend:accepted", onFriendAccepted);
    socket.on("session:kick", onSessionKick);
    socket.on("match:topic", onTopic);

    // Unsubscribe on unmount / when the provider gives us a new socket.
    // We DO NOT call `socket.disconnect()` — the socket outlives the
    // consuming component (see SocketContext.tsx).
    return () => {
      socket.off("match:waiting", onWaiting);
      socket.off("match:found", onFound);
      socket.off("partner:left", onPartnerLeft);
      socket.off("partner:disconnected", onPartnerDisconnected);
      socket.off("partner:rejoined", onPartnerRejoined);
      socket.off("room:ready", onReady);
      socket.off("room:error", onRoomError);

      socket.off("signal:offer", onOffer);
      socket.off("signal:answer", onAnswer);
      socket.off("signal:ice", onIce);

      socket.off("friend:request", onFriendRequest);
      socket.off("friend:accepted", onFriendAccepted);
      socket.off("session:kick", onSessionKick);
      socket.off("match:topic", onTopic);
    };
  }, [socket]);

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
