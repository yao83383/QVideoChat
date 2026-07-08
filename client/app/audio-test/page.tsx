"use client";

import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:3002";
const SOCKET_PATH = process.env.NEXT_PUBLIC_SOCKET_PATH || "/socket.io";
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: ["stun:8.140.249.127:3478", "turn:8.140.249.127:3478"], username: "turn", credential: "turn123456" },
    { urls: "stun:stun.miwifi.com:3478" },
    { urls: "stun:stun.l.google.com:19302" },
  ],
};

interface Stats {
  sent?: number;
  sentBytes?: number;
  recv?: number;
  recvBytes?: number;
  packetsLost?: number;
  jitter?: number;
  iceState?: string;
  connState?: string;
  pairType?: string;
  trackMuted?: boolean;
  localTrackMuted?: boolean;
  localTrackEnabled?: boolean;
}

export default function AudioTest() {
  const [inputRoom, setInputRoom] = useState("");
  const [inCall, setInCall] = useState(false);
  const [status, setStatus] = useState("准备就绪");
  const [stats, setStats] = useState<Stats>({});
  const [log, setLog] = useState<string[]>([]);
  const [shareUrl, setShareUrl] = useState("");

  const socketRef = useRef<Socket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const statsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const roomIdRef = useRef<string>("");

  const addLog = (msg: string) => {
    console.log("[audio-test]", msg);
    setLog((prev) => {
      const ts = new Date().toTimeString().slice(0, 8);
      const next = [...prev, `${ts} ${msg}`];
      return next.length > 50 ? next.slice(-50) : next;
    });
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const room = params.get("room");
    if (room) setInputRoom(room);
    setShareUrl(`${window.location.origin}${BASE_PATH}/audio-test`);
  }, []);

  const createRoom = () => {
    const id = Math.random().toString(36).slice(2, 8);
    setInputRoom(id);
    const url = new URL(window.location.href);
    url.searchParams.set("room", id);
    window.history.replaceState({}, "", url.toString());
  };

  const startStats = () => {
    if (statsTimerRef.current) clearInterval(statsTimerRef.current);
    statsTimerRef.current = setInterval(async () => {
      const pc = pcRef.current;
      if (!pc || pc.connectionState !== "connected") return;
      try {
        const st = await pc.getStats();
        const summary: Stats = {};
        st.forEach((r: any) => {
          if (r.type === "outbound-rtp" && r.kind === "audio") {
            summary.sent = r.packetsSent;
            summary.sentBytes = r.bytesSent;
          }
          if (r.type === "inbound-rtp" && r.kind === "audio") {
            summary.recv = r.packetsReceived;
            summary.recvBytes = r.bytesReceived;
            summary.packetsLost = r.packetsLost;
            summary.jitter = r.jitter;
          }
          if (r.type === "candidate-pair" && r.nominated && r.state === "succeeded") {
            const local = st.get(r.localCandidateId) as any;
            const remote = st.get(r.remoteCandidateId) as any;
            summary.pairType = `${local?.candidateType ?? "?"} / ${remote?.candidateType ?? "?"}`;
          }
        });
        const recv = pc.getReceivers().find((r) => r.track.kind === "audio");
        if (recv) summary.trackMuted = recv.track.muted;
        const sender = pc.getSenders().find((s) => s.track?.kind === "audio");
        if (sender?.track) {
          summary.localTrackMuted = sender.track.muted;
          summary.localTrackEnabled = sender.track.enabled;
        }
        setStats((prev) => ({ ...prev, ...summary }));
      } catch {}
    }, 1500);
  };

  const start = async () => {
    const room = inputRoom.trim();
    if (!room) return;
    roomIdRef.current = room;
    setInCall(true);
    setStatus("获取麦克风权限...");
    addLog(`join room=${room}`);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      localStreamRef.current = stream;
      const track = stream.getAudioTracks()[0];
      addLog(`mic ok id=${track.id.slice(0, 8)} enabled=${track.enabled} muted=${track.muted} label="${track.label}"`);

      const pc = new RTCPeerConnection(RTC_CONFIG);
      pcRef.current = pc;

      pc.oniceconnectionstatechange = () => {
        addLog(`ice=${pc.iceConnectionState}`);
        setStats((s) => ({ ...s, iceState: pc.iceConnectionState }));
      };
      pc.onconnectionstatechange = () => {
        addLog(`conn=${pc.connectionState}`);
        setStats((s) => ({ ...s, connState: pc.connectionState }));
        if (pc.connectionState === "connected") startStats();
      };
      pc.onicecandidate = (e) => {
        if (e.candidate) {
          socketRef.current?.emit("test:ice", { roomId: room, candidate: e.candidate.toJSON() });
        }
      };
      pc.ontrack = (e) => {
        addLog(`ontrack kind=${e.track.kind} muted=${e.track.muted} streams=${e.streams.length}`);
        if (e.track.kind !== "audio") return;
        const s = e.streams[0] || new MediaStream([e.track]);
        if (audioRef.current) {
          audioRef.current.srcObject = s;
          audioRef.current.play()
            .then(() => addLog("audio.play OK"))
            .catch((err) => addLog(`audio.play FAIL ${err?.name}`));
        }
        e.track.onunmute = () => addLog(`>>> REMOTE UNMUTED (packets flowing!) <<<`);
        e.track.onmute = () => addLog(`>>> REMOTE MUTED (packets stopped) <<<`);
      };

      pc.addTrack(track, stream);
      addLog(`addTrack senders=${pc.getSenders().length}`);

      const socket = io(SERVER_URL, { path: SOCKET_PATH, transports: ["websocket", "polling"] });
      socketRef.current = socket;

      socket.on("connect", () => {
        addLog(`socket connected id=${socket.id?.slice(0, 6)}`);
        socket.emit("test:join", { roomId: room });
        setStatus("等待对方加入...");
      });

      socket.on("test:full", () => {
        addLog(`ERROR: room full (>2 peers)`);
        setStatus("房间已满");
      });

      socket.on("test:ready", async ({ initiator }: { initiator: boolean }) => {
        addLog(`ready initiator=${initiator}`);
        setStatus(initiator ? "作为发起方，发 offer..." : "作为应答方，等 offer...");
        if (initiator) {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit("test:offer", { roomId: room, sdp: offer });
          addLog(`sent offer`);
        }
      });

      socket.on("test:offer", async ({ sdp }: { sdp: RTCSessionDescriptionInit }) => {
        addLog(`recv offer`);
        setStatus("收到 offer, 生成 answer...");
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("test:answer", { roomId: room, sdp: answer });
        addLog(`sent answer`);
      });

      socket.on("test:answer", async ({ sdp }: { sdp: RTCSessionDescriptionInit }) => {
        addLog(`recv answer`);
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      });

      socket.on("test:ice", async ({ candidate }: { candidate: RTCIceCandidateInit }) => {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch {
          // ignore stale candidates
        }
      });

      socket.on("test:partner-left", () => {
        addLog(`partner left`);
        setStatus("对方已离开");
      });
    } catch (e: any) {
      addLog(`ERROR: ${e?.message || e}`);
      setStatus(`错误: ${e?.message || e}`);
      stop();
    }
  };

  const stop = () => {
    if (statsTimerRef.current) { clearInterval(statsTimerRef.current); statsTimerRef.current = null; }
    if (roomIdRef.current) {
      socketRef.current?.emit("test:leave", { roomId: roomIdRef.current });
    }
    pcRef.current?.close();
    pcRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    socketRef.current?.disconnect();
    socketRef.current = null;
    if (audioRef.current) { audioRef.current.srcObject = null; }
    setInCall(false);
    setStatus("已停止");
    setStats({});
    addLog(`stop`);
  };

  useEffect(() => () => stop(), []);

  const shareLink = shareUrl && inputRoom ? `${shareUrl}?room=${inputRoom}` : "";

  return (
    <main className="min-h-screen bg-black text-white p-4 font-mono">
      <audio ref={audioRef} autoPlay playsInline hidden />
      <div className="max-w-2xl mx-auto space-y-4">
        <div>
          <h1 className="text-lg font-bold">🎙 音频隔离测试</h1>
          <p className="text-xs text-neutral-500 mt-1">只做 WebRTC 音频，无 face mesh / VRM / DC / 匹配</p>
        </div>

        {!inCall && (
          <div className="space-y-3 rounded-lg bg-neutral-900 border border-neutral-700 p-4">
            <div className="flex gap-2">
              <input
                value={inputRoom}
                onChange={(e) => setInputRoom(e.target.value)}
                placeholder="房间 ID"
                className="flex-1 bg-neutral-950 border border-neutral-700 rounded px-3 py-2 text-sm"
              />
              <button
                onClick={createRoom}
                className="bg-neutral-800 border border-neutral-600 rounded px-3 py-2 text-sm hover:bg-neutral-700"
              >
                随机
              </button>
            </div>
            {shareLink && (
              <div className="text-xs text-neutral-400 break-all bg-neutral-950 rounded p-2">
                <span className="text-neutral-500">分享给对方: </span>
                <span className="text-blue-300">{shareLink}</span>
              </div>
            )}
            <button
              onClick={start}
              disabled={!inputRoom.trim()}
              className="w-full bg-green-600 disabled:bg-neutral-800 disabled:text-neutral-600 rounded py-3 text-sm font-bold hover:bg-green-500"
            >
              开始通话
            </button>
          </div>
        )}

        {inCall && (
          <>
            <div className="rounded-lg bg-neutral-900 border border-neutral-700 p-4 space-y-2">
              <div className="text-lg">{status}</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <div>ICE: <span className={stats.iceState === "connected" ? "text-green-400" : "text-yellow-400"}>{stats.iceState || "-"}</span></div>
                <div>Conn: <span className={stats.connState === "connected" ? "text-green-400" : "text-yellow-400"}>{stats.connState || "-"}</span></div>
                <div className="col-span-2">候选对: <span className="text-blue-300">{stats.pairType || "-"}</span></div>
                <div>本地轨道: <span className={stats.localTrackMuted === false && stats.localTrackEnabled ? "text-green-400" : "text-red-400"}>
                  {stats.localTrackEnabled === undefined ? "-" : stats.localTrackEnabled ? (stats.localTrackMuted ? "enabled 但 muted" : "enabled ok") : "disabled"}
                </span></div>
                <div>远端轨道: <span className={stats.trackMuted === false ? "text-green-400" : "text-red-400"}>
                  {stats.trackMuted === undefined ? "-" : stats.trackMuted ? "muted (无包)" : "unmuted (通!)"}
                </span></div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-neutral-900 border border-neutral-700 p-4">
                <div className="text-neutral-400 text-xs mb-1">📤 发送 (我 → 对方)</div>
                <div className="text-3xl font-bold text-white">{stats.sent ?? "-"}</div>
                <div className="text-xs text-neutral-500">包</div>
                <div className="text-xs text-neutral-400 mt-1">{stats.sentBytes ? `${Math.round(stats.sentBytes / 1024)} KB` : "-"}</div>
              </div>
              <div className="rounded-lg bg-neutral-900 border border-neutral-700 p-4">
                <div className="text-neutral-400 text-xs mb-1">📥 接收 (对方 → 我)</div>
                <div className={`text-3xl font-bold ${(stats.recv || 0) > 0 ? "text-green-400" : "text-red-400"}`}>{stats.recv ?? "-"}</div>
                <div className="text-xs text-neutral-500">包</div>
                <div className="text-xs text-neutral-400 mt-1">
                  {stats.recvBytes ? `${Math.round(stats.recvBytes / 1024)} KB` : "-"}
                  {(stats.packetsLost ?? 0) > 0 && <span className="text-red-400 ml-2">丢 {stats.packetsLost}</span>}
                </div>
              </div>
            </div>

            <button
              onClick={stop}
              className="w-full bg-red-700 hover:bg-red-600 rounded py-2 text-sm font-bold"
            >
              结束通话
            </button>

            <div className="rounded-lg bg-neutral-900 border border-neutral-700 p-3">
              <div className="text-neutral-400 text-xs mb-2">日志（最近 50 条）</div>
              <div className="text-[10px] leading-tight space-y-0.5 max-h-96 overflow-y-auto">
                {log.map((l, i) => (
                  <div key={i} className={
                    l.includes("ERROR") ? "text-red-400" :
                    l.includes("UNMUTED") ? "text-green-400 font-bold" :
                    l.includes("MUTED") ? "text-yellow-400" :
                    "text-neutral-300"
                  }>{l}</div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
