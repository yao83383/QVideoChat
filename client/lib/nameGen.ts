/** Random cute nickname generator. Data comes from the /names/ folder
 *  (原始数据: 前缀词.txt / 女声随机词.txt / 男生随机词.txt) — baked in as
 *  arrays here so the client bundle is self-contained (no fetch, no cache
 *  problems, works offline). Total data is ~3KB, trivial addition to bundle.
 *
 *  If the source .txt files change, update these arrays and re-deploy —
 *  they're static enough that a build-time codegen isn't worth it. */

// 20 前缀词
const PREFIXES: string[] = [
  "正在发呆的", "打哈欠的", "假装营业的", "连滚带爬的", "拒绝加班的",
  "暗中观察的", "碳水超标的", "容易害羞的", "刚睡醒的", "正在加载的",
  "傲娇的",     "糯叽叽的", "奶呼呼的",   "有点社恐的", "古灵精怪的",
  "元气满满的", "心不在焉的", "满脑子干饭的", "慢吞吞的", "超有耐心的",
];

// 23 个女生词根 —— 软萌系(水蜜桃 / 糯米糍 / 团子...)
const FEMALE_BASES: string[] = [
  "水蜜桃", "小草莓", "棉花糖", "泡芙",   "小布丁",
  "糯米糍", "气泡水", "软糖",   "小樱桃", "流心酥",
  "咩咩",   "团子",   "啵啵",   "桃子",   "悠悠",
  "妙妙",   "呦呦",   "笑笑",   "朵朵",   "西西",
  "软软",   "萌萌",   "果果",
];

// 23 个男生词根 —— 憨憨系(小土豆 / 铁柱 / 大壮...)
const MALE_BASES: string[] = [
  "小土豆", "小饭团", "厚椰乳", "铜锣烧", "大福",
  "开心果", "松子",   "面包蟹", "小蘑菇", "麦芽糖",
  "阿强",   "阿杰",   "仔仔",   "波波",   "大壮",
  "小满",   "木木",   "壮壮",   "铁柱",   "阿亮",
  "呆呆",   "飞鱼",   "风风",
];

export type NameGender = "female" | "male" | "private";

function pick<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

/** Generate a random Q版 nickname. "private" gender draws from both pools
 *  so users who don't want to declare still get variety. */
export function generateRandomName(gender: NameGender): string {
  const pool = gender === "female" ? FEMALE_BASES
             : gender === "male"   ? MALE_BASES
             : [...FEMALE_BASES, ...MALE_BASES];
  return pick(PREFIXES) + pick(pool);
}

/** Speak the just-rolled name via Web Speech API. Best-effort — some
 *  browsers (Linux, Safari older) may not have Chinese voices and fall back
 *  to silence rather than the wrong language. Slightly higher pitch to
 *  match the Q版 cute vibe.
 *
 *  Kept exported for optional use, but /login uses the AudioContext-based
 *  sparkle chime below instead — system TTS quality varies too much and the
 *  Chinese voices on many systems are grating. */
export function speakName(name: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    // Cancel any queued utterances so rapid rolls don't stack up.
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(`你好呀,我是${name}~`);
    utter.lang = "zh-CN";
    utter.rate = 0.95;
    utter.pitch = 1.25;
    // Pick a female-ish Chinese voice if the browser exposes voice names.
    const voices = window.speechSynthesis.getVoices();
    const zhVoice = voices.find((v) => /^zh/i.test(v.lang) && /female|xiaoxiao|yaoyao|zhiyu/i.test(v.name))
                 ?? voices.find((v) => /^zh/i.test(v.lang));
    if (zhVoice) utter.voice = zhVoice;
    window.speechSynthesis.speak(utter);
  } catch { /* ignore — voice is nice-to-have, not core */ }
}

// --- Sparkle audio (Web Audio API, no external files, no system TTS) ---
//
// Generates cute tones programmatically. Portable across browsers, no
// download, no voice-package pain. Two effects:
//   playRollTick  · short pluck per shuffle iteration (variable pitch)
//   playSparkleChime · C-major arpeggio "twinkle" when the name settles
//
// One shared AudioContext to avoid the "too many contexts" warning some
// browsers emit. Resumed lazily since autoplay rules require a user gesture
// to unblock a suspended context.

let audioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor: typeof AudioContext | undefined =
    (window as any).AudioContext ?? (window as any).webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx) {
    try { audioCtx = new Ctor(); }
    catch { return null; }
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => { /* ignore */ });
  }
  return audioCtx;
}

/** Short percussive pluck. Called on each dice-shuffle iteration so the
 *  cycling numbers feel physical rather than silent. Pitch varied to add
 *  organic randomness. */
export function playRollTick() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    // Random-ish pitch in a cheerful range (E5 - E6)
    osc.frequency.value = 550 + Math.random() * 550;
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.08, now + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.07);
  } catch { /* ignore */ }
}

/** Twinkle "叮~叮~叮~" chime for when the roll settles. Four notes of a
 *  C-major triad + octave give a satisfying "you win!" feel without being
 *  loud. */
export function playSparkleChime() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  try {
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 · E5 · G5 · C6
    const now = ctx.currentTime;
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t = now + i * 0.06;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.12, t + 0.015);
      // Longer tail on the final note to punctuate the reveal.
      const decay = i === notes.length - 1 ? 0.55 : 0.32;
      gain.gain.exponentialRampToValueAtTime(0.001, t + decay);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + decay + 0.02);
    });
  } catch { /* ignore */ }
}
