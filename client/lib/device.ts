let cached: string | null = null;

function hash(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

function computeFingerprint(): string {
  const parts = [
    navigator.userAgent,
    `${screen.width}x${screen.height}x${screen.colorDepth}`,
    navigator.hardwareConcurrency ?? "unknown",
    navigator.language,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    navigator.platform ?? "unknown",
    navigator.maxTouchPoints ?? 0,
  ];
  return hash(parts.join("|"));
}

export function getDeviceId(): string {
  if (cached) return cached;

  // Prefer stored device ID for consistency
  if (typeof window !== "undefined") {
    const stored = localStorage.getItem("deviceId");
    if (stored) {
      cached = stored;
      return cached;
    }
  }

  const fingerprint = computeFingerprint();
  const deviceId = hash(fingerprint);

  if (typeof window !== "undefined") {
    localStorage.setItem("deviceId", deviceId);
    cached = deviceId;
  }

  return deviceId;
}
