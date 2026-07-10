/**
 * Tencent Cloud realtime ASR proxy.
 *
 * Clients connect to /asr on our server (wss://.../qsignal/asr in prod). We
 * open a matching WebSocket to Tencent's realtime ASR endpoint on their
 * behalf, signing the request with our SecretKey (which never leaves the
 * server). Audio bytes flow client → us → Tencent; recognition JSON flows
 * Tencent → us → client.
 *
 * Protocol reference:
 *   https://cloud.tencent.com/document/product/1093/48982
 */

import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import crypto from "node:crypto";
import { randomUUID } from "node:crypto";

const HOST = "asr.cloud.tencent.com";

function mapEngine(lang: string): string {
  switch (lang) {
    case "en":
      return "16k_en";
    case "ja":
      return "16k_ja";
    case "ko":
      return "16k_ko";
    case "zh":
    default:
      return "16k_zh";
  }
}

export function setupAsrProxy(httpServer: HttpServer): void {
  // Read env HERE, not at module top-level: ES module imports are hoisted, so
  // reading process.env at module scope runs BEFORE our .env.production loader
  // in index.ts has finished. Deferring the read to setup() time (which runs
  // after loadEnv) sees the values.
  const APPID = process.env.TENCENT_APPID || "";
  const SECRETID = process.env.TENCENT_SECRETID || "";
  const SECRETKEY = process.env.TENCENT_SECRETKEY || "";

  if (!(APPID && SECRETID && SECRETKEY)) {
    console.warn(
      "[asrProxy] disabled — set TENCENT_APPID / TENCENT_SECRETID / TENCENT_SECRETKEY to enable",
    );
    return;
  }
  console.log("[asrProxy] enabled, appId=", APPID);

  /**
   * Build a signed wss:// URL for a fresh Tencent ASR session. Signature scheme:
   *   1. sort query params by key ascending
   *   2. concat as key=value&key=value
   *   3. prefix with host+path: `asr.cloud.tencent.com/asr/v2/{appId}?...`
   *   4. HMAC-SHA1 with SecretKey → base64 → append as `signature=<url-encoded>`
   */
  function buildTencentUrl(lang: string): string {
    const engine = mapEngine(lang);
    const voiceId = randomUUID();
    const timestamp = Math.floor(Date.now() / 1000);
    const expired = timestamp + 86400;
    const nonce = Math.floor(Math.random() * 1_000_000).toString();

    const params: Record<string, string | number> = {
      secretid: SECRETID,
      timestamp,
      expired,
      nonce,
      engine_model_type: engine,
      voice_id: voiceId,
      voice_format: 1,       // 1 = PCM
      needvad: 1,            // Tencent-side VAD; emits slice_type=2 on utterance end
      filter_dirty: 0,       // don't filter sensitive words
      filter_modal: 0,       // keep filler words
      filter_punc: 0,        // keep punctuation
      convert_num_mode: 1,   // "一二三" → "123"
    };

    const sortedKeys = Object.keys(params).sort();
    const paramStr = sortedKeys.map((k) => `${k}=${params[k]}`).join("&");
    const signStr = `${HOST}/asr/v2/${APPID}?${paramStr}`;
    const hmac = crypto.createHmac("sha1", SECRETKEY);
    hmac.update(signStr);
    const signature = hmac.digest("base64");
    // Redact SecretID for the log so we can still verify structure without
    // leaking credentials.
    const signStrRedacted = signStr.replace(
      SECRETID,
      SECRETID.slice(0, 8) + "..." + SECRETID.slice(-4),
    );
    console.log("[asrProxy] signStr=", signStrRedacted);
    console.log("[asrProxy] signature=", signature);
    return `wss://${HOST}/asr/v2/${APPID}?${paramStr}&signature=${encodeURIComponent(signature)}`;
  }

  function handleAsrConnection(client: WebSocket, req: IncomingMessage) {
    const url = new URL(req.url || "/", "http://localhost");
    const lang = (url.searchParams.get("lang") || "zh").split("-")[0];
    const clientTag = req.socket.remoteAddress || "?";
    console.log(`[asrProxy] client connected addr=${clientTag} lang=${lang}`);

    let tencentUrl: string;
    try {
      tencentUrl = buildTencentUrl(lang);
    } catch (e: any) {
      console.error("[asrProxy] failed to sign URL:", e?.message || e);
      client.close(1011, "sign failed");
      return;
    }

    const upstream = new WebSocket(tencentUrl);
    let upstreamReady = false;
    const pending: Array<Buffer | string> = [];

    const closeBoth = (reason: string) => {
      try {
        if (upstream.readyState === WebSocket.OPEN) {
          upstream.send(JSON.stringify({ type: "end" }));
        }
        if (upstream.readyState !== WebSocket.CLOSED) upstream.close();
      } catch { /* ignore */ }
      try {
        if (client.readyState === WebSocket.OPEN) client.close(1000, reason);
      } catch { /* ignore */ }
    };

    upstream.on("open", () => {
      upstreamReady = true;
      console.log("[asrProxy] tencent upstream open");
      for (const m of pending) {
        try { upstream.send(m); } catch { /* ignore */ }
      }
      pending.length = 0;
    });

    upstream.on("message", (data) => {
      if (client.readyState === WebSocket.OPEN) {
        const text = typeof data === "string" ? data : data.toString();
        // Log auth / structural error responses so we can debug.
        try {
          const parsed = JSON.parse(text);
          if (parsed.code !== 0 && parsed.code !== undefined) {
            console.warn("[asrProxy] tencent error code=", parsed.code, "msg=", parsed.message);
          }
        } catch { /* not JSON */ }
        client.send(text);
      }
    });

    upstream.on("close", (code, reason) => {
      console.log("[asrProxy] tencent upstream closed", code, reason?.toString());
      closeBoth("upstream closed");
    });

    upstream.on("error", (err) => {
      console.warn("[asrProxy] tencent upstream error:", err.message);
      closeBoth("upstream error");
    });

    client.on("message", (data, isBinary) => {
      const payload = isBinary ? (data as Buffer) : data.toString();
      if (upstreamReady) {
        try { upstream.send(payload); } catch { /* channel died */ }
      } else {
        pending.push(payload);
        if (pending.length > 512) pending.shift();
      }
    });

    client.on("close", () => {
      console.log("[asrProxy] client closed");
      closeBoth("client closed");
    });

    client.on("error", (err) => {
      console.warn("[asrProxy] client error:", err.message);
    });
  }

  const wss = new WebSocketServer({ noServer: true });
  wss.on("connection", handleAsrConnection);

  // Register our upgrade handler before socket.io attaches to the same server.
  // socket.io's own upgrade listener will fire for other paths as normal.
  httpServer.on("upgrade", (req, socket, head) => {
    const url = req.url || "";
    if (!url.startsWith("/asr")) return;
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });
}
