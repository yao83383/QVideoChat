"use client";

import { Suspense, useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useUser } from "@/hooks/useUser";
import { inviteApply, inviteMyPending, inviteOfficialId, inviteCheck, login as apiLogin } from "@/lib/api";
import type { MyPendingStatus } from "@/lib/api";
import { generateRandomName, playRollTick, playSparkleChime, type NameGender } from "@/lib/nameGen";

type Mode = "register" | "login" | "waiting" | "success" | "rejected" | "expired";

function isPhone(s: string) { return /^1[3-9]\d{9}$/.test(s); }
function isEmail(s: string) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s); }
function isDigits(s: string, min: number, max: number) { return new RegExp(`^\\d{${min},${max}}$`).test(s); }

function LoginForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const { doLogin, doLoginByIdentifier, doPhoneAuth } = useUser();

  const [mode, setMode] = useState<Mode>("register");

  // Registration form state
  const [inviterDisplayId, setInviterDisplayId] = useState(sp.get("invite") || "");
  const [contactType, setContactType] = useState<"phone" | "email" | "skip">("phone");
  const [contact, setContact] = useState("");
  const [password, setPassword] = useState("");
  const [gender, setGender] = useState<NameGender | null>(null);
  const [username, setUsername] = useState("");
  const [noContactWarn, setNoContactWarn] = useState(false); // track for success page
  const [rolling, setRolling] = useState(false);
  const rollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Inviter eligibility check — pressed by user, doesn't auto-fire because
  // network noise + user reading time make debounce awkward. Reset when the
  // ID input changes so old results don't linger.
  type CheckState = { status: "idle" | "checking" | "ok" | "bad"; message?: string; isOfficial?: boolean };
  const [check, setCheck] = useState<CheckState>({ status: "idle" });
  useEffect(() => { setCheck({ status: "idle" }); }, [inviterDisplayId]);
  const runCheck = async () => {
    if (!isDigits(inviterDisplayId, 3, 11)) {
      setCheck({ status: "bad", message: "ID 格式不正确" });
      return;
    }
    setCheck({ status: "checking" });
    try {
      const r = await inviteCheck(inviterDisplayId);
      if (r.eligible) {
        const label = r.isOfficial ? "官方通道 · 可用" : `可用${r.username ? " · " + r.username : ""}`;
        setCheck({ status: "ok", message: label, isOfficial: r.isOfficial });
      } else {
        setCheck({ status: "bad", message: r.reason || "不可用" });
      }
    } catch (e: any) {
      setCheck({ status: "bad", message: e?.message || "检查失败" });
    }
  };

  // When gender is first picked, drop a fresh random name in the username
  // field so the user isn't looking at an empty box. Skip if they already
  // typed something custom.
  useEffect(() => {
    if (gender && !username) {
      setUsername(generateRandomName(gender));
    }
  }, [gender]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRoll = () => {
    if (!gender || rolling) return;
    setRolling(true);
    // Rapid-cycle for ~450ms — pure UI candy for the "dice-roll" feel.
    // Each iteration ticks a short pluck, then the final settle plays a
    // twinkle chime. No system TTS — all sounds generated via Web Audio.
    let ticks = 0;
    rollTimerRef.current = setInterval(() => {
      ticks++;
      setUsername(generateRandomName(gender));
      playRollTick();
      if (ticks >= 5) {
        if (rollTimerRef.current) clearInterval(rollTimerRef.current);
        const final = generateRandomName(gender);
        setUsername(final);
        setRolling(false);
        playSparkleChime();
      }
    }, 90);
  };
  useEffect(() => () => { if (rollTimerRef.current) clearInterval(rollTimerRef.current); }, []);

  // Login form state
  const [loginId, setLoginId] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  // Waiting state
  const [pending, setPending] = useState<MyPendingStatus | null>(null);
  const [displayId, setDisplayId] = useState<string | null>(null);

  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPreSubmit, setShowPreSubmit] = useState(false);

  // Live official displayId shown in the "cold-start hint"
  const [officialId, setOfficialId] = useState("100");
  useEffect(() => {
    inviteOfficialId().then((r) => setOfficialId(r.displayId)).catch(() => {});
  }, []);

  // Polling: while in waiting mode, hit /invite/my-pending every 4s to notice
  // approval (or expiry) without needing socket wiring. Cheap query, expires
  // itself as needed on server side.
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (mode !== "waiting") {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      return;
    }
    const tick = async () => {
      try {
        const s = await inviteMyPending();
        if (!s) return;
        setPending(s);
        if (s.myIsConfirmed && s.myDisplayId) {
          setDisplayId(s.myDisplayId);
          setMode("success");
        } else if (s.status === "rejected") {
          setMode("rejected");
        } else if (s.status === "expired" || (s.status === "pending" && s.remainingMs <= 0)) {
          setMode("expired");
        }
      } catch { /* transient */ }
    };
    tick();
    pollTimerRef.current = setInterval(tick, 4000);
    return () => { if (pollTimerRef.current) clearInterval(pollTimerRef.current); };
  }, [mode]);

  const handleRegisterClick = () => {
    setError("");
    if (!isDigits(inviterDisplayId, 3, 11)) { setError("邀请人 ID 必须是 3-11 位数字"); return; }
    if (check.status === "bad") { setError(`邀请人不可用:${check.message}`); return; }
    if (password.length < 6) { setError("密码至少 6 位"); return; }
    if (!gender) { setError("请选择性别"); return; }
    if (!username.trim()) { setError("请生成一个昵称"); return; }
    if (contactType === "email" && contact && !isEmail(contact)) { setError("邮箱格式不正确"); return; }
    if (contactType === "phone" && contact && !isPhone(contact)) { setError("手机号格式不正确"); return; }
    // Show sync-coordination warning first (unless OFFICIAL cold-start path)
    if (inviterDisplayId === officialId) {
      submitRegister();
    } else {
      setShowPreSubmit(true);
    }
  };

  const submitRegister = async () => {
    setShowPreSubmit(false);
    setBusy(true);
    const emailToSend = contactType === "email" && contact ? contact : undefined;
    const phoneToSend = contactType === "phone" && contact ? contact : undefined;
    setNoContactWarn(!emailToSend && !phoneToSend);
    try {
      const resp = await inviteApply({
        inviterDisplayId,
        email: emailToSend,
        phone: phoneToSend,
        password,
        username: username.trim() || undefined,
        gender: gender ?? undefined,
      });
      if (resp.autoConfirmed && resp.displayId) {
        setDisplayId(resp.displayId);
        setMode("success");
      } else {
        setMode("waiting");
      }
    } catch (e: any) {
      setError(e?.message || "注册失败");
    } finally {
      setBusy(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!loginId || !loginPassword) { setError("请填写账号和密码"); return; }
    setBusy(true);
    try {
      // Server matches identifier against email / phone / displayId — the
      // client no longer needs to guess what the user typed.
      await doLoginByIdentifier(loginId.trim(), loginPassword);
      router.push("/");
    } catch (e: any) {
      setError(e?.message || "登录失败");
    } finally {
      setBusy(false);
    }
  };

  const restartRegister = () => {
    setMode("register");
    setPending(null);
    setError("");
  };

  // --- Waiting page ---
  if (mode === "waiting") {
    const remaining = pending ? Math.max(0, Math.floor(pending.remainingMs / 1000)) : 120;
    const mm = String(Math.floor(remaining / 60)).padStart(1, "0");
    const ss = String(remaining % 60).padStart(2, "0");
    return (
      <main className="flex min-h-screen flex-col items-center justify-center px-4 gap-6">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-sky-400 via-cyan-400 to-amber-400 flex items-center justify-center text-2xl shadow-lg shadow-amber-500/30 animate-pulse">⏳</div>
        <h1 className="text-2xl font-bold text-slate-900">申请中</h1>
        <p className="text-slate-600 text-sm text-center max-w-sm">
          正在等待 <span className="text-slate-900 font-medium">{pending?.targetUsername || "邀请人"}</span>(<span className="font-mono text-slate-800">{pending?.targetDisplayId || inviterDisplayId}</span>) 审核
        </p>
        <div className="text-5xl font-mono tracking-widest tabular-nums text-sky-600">
          {mm}:{ss}
        </div>
        <div className="w-full max-w-sm rounded-2xl bg-amber-50 border border-amber-300 px-5 py-4">
          <p className="text-amber-800 text-sm font-semibold mb-1">请勿关闭本页面</p>
          <p className="text-amber-700/90 text-xs leading-relaxed">
            请立即联系邀请人(电话/微信),让 TA 打开 QVideoChat 通过你的申请。 2 分钟内未通过将自动作废。
          </p>
        </div>
      </main>
    );
  }

  // --- Success page ---
  if (mode === "success" && displayId) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center px-4 gap-6 py-8">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-500 flex items-center justify-center text-2xl text-white shadow-lg shadow-emerald-500/30">✓</div>
        <h1 className="text-2xl font-bold text-slate-900">注册成功</h1>
        <div className="w-full max-w-sm rounded-3xl bg-white border border-sky-200 shadow-xl shadow-sky-500/10 p-6 flex flex-col items-center gap-3">
          <p className="text-xs text-slate-500 tracking-widest uppercase">你的 ID</p>
          <p className="text-4xl font-mono font-bold tracking-widest tabular-nums bg-gradient-to-r from-sky-500 to-cyan-500 bg-clip-text text-transparent">
            {displayId}
          </p>
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(displayId).catch(() => {})}
            className="mt-2 rounded-full bg-slate-100 hover:bg-sky-100 border border-slate-200 hover:border-sky-300 px-4 py-1.5 text-xs font-medium text-slate-700 transition"
          >
            复制
          </button>
          <p className="text-xs text-slate-500 text-center mt-2">请截图或复制保存 · 以后可用它登录</p>
        </div>

        {/* Extra warning when the user chose to skip contact binding — no
            recovery channel exists, so losing displayId/password = losing
            account. Prompt them to bind something later in settings. */}
        {noContactWarn && (
          <div className="w-full max-w-sm rounded-2xl bg-rose-50 border border-rose-300 px-5 py-4">
            <p className="text-rose-700 text-sm font-semibold mb-1">未绑定手机号 / 邮箱</p>
            <p className="text-rose-600/90 text-xs leading-relaxed">
              请务必截图 <span className="font-semibold">ID + 密码</span> 保存。 忘了将<span className="font-semibold">无法找回</span>账号。 建议进入后在设置里绑定一个,方便以后找回。
            </p>
          </div>
        )}

        <button
          type="button"
          onClick={() => router.push("/")}
          className="w-full max-w-sm rounded-2xl bg-gradient-to-r from-sky-400 via-cyan-400 to-amber-400 hover:from-sky-500 hover:via-cyan-500 hover:to-amber-500 text-white px-6 py-3 text-sm font-semibold transition shadow-lg shadow-amber-500/30"
        >
          进入 QVideoChat
        </button>
      </main>
    );
  }

  // --- Rejected / expired page ---
  if (mode === "rejected" || mode === "expired") {
    const isRej = mode === "rejected";
    return (
      <main className="flex min-h-screen flex-col items-center justify-center px-4 gap-6">
        <div className="w-14 h-14 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center text-2xl">{isRej ? "✕" : "⏰"}</div>
        <h1 className="text-2xl font-bold text-slate-900">{isRej ? "邀请被拒绝" : "申请超时"}</h1>
        <p className="text-slate-600 text-sm text-center max-w-sm">
          {isRej
            ? "邀请人拒绝了你的申请。 你可以换一位已注册的用户重试。"
            : "邀请人在 2 分钟内没有通过你的申请。 请先联系邀请人,让 TA 打开 QVideoChat 后再申请。"}
        </p>
        <div className="flex flex-col gap-2 w-full max-w-sm">
          <button
            type="button"
            onClick={restartRegister}
            className="w-full rounded-2xl bg-gradient-to-r from-sky-400 via-cyan-400 to-amber-400 hover:from-sky-500 hover:via-cyan-500 hover:to-amber-500 text-white px-6 py-3 text-sm font-semibold transition shadow-lg shadow-amber-500/30"
          >
            重新申请
          </button>
          <button
            type="button"
            onClick={() => router.push("/")}
            className="text-xs text-slate-500 hover:text-slate-800 transition py-2"
          >
            返回首页(以游客身份继续)
          </button>
        </div>
      </main>
    );
  }

  // --- Register / Login form ---
  return (
    <main className="relative flex min-h-screen flex-col items-center px-4 pt-6 pb-8">
      <button
        onClick={() => router.push("/")}
        className="absolute top-4 left-4 text-xs text-slate-500 hover:text-slate-900 transition"
      >
        &larr; 返回
      </button>

      <div className="mt-12 flex flex-col items-center gap-2 mb-8">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-sky-400 via-cyan-400 to-amber-400 flex items-center justify-center text-2xl mb-2 shadow-lg shadow-amber-500/30">🎭</div>
        <h1 className="text-2xl font-bold text-slate-900">加入 QVideoChat</h1>
        <p className="text-slate-500 text-xs">邀请制内测 · 需要邀请人 ID</p>
      </div>

      <div className="w-full max-w-sm">
        <div className="flex border-b border-slate-200 mb-6">
          <button type="button"
            className={`flex-1 py-2.5 text-sm font-semibold transition ${mode === "register" ? "text-sky-600 border-b-2 border-sky-500" : "text-slate-500 hover:text-slate-800"}`}
            onClick={() => setMode("register")}
          >注册</button>
          <button type="button"
            className={`flex-1 py-2.5 text-sm font-semibold transition ${mode === "login" ? "text-sky-600 border-b-2 border-sky-500" : "text-slate-500 hover:text-slate-800"}`}
            onClick={() => setMode("login")}
          >登录</button>
        </div>

        {mode === "register" && (
          <div className="flex flex-col gap-3">
            {(() => {
              // Live validity flags for the required fields — drives the
              // green/red border + label hint so the user knows at a glance
              // what still needs to be filled.
              const inviterOk = isDigits(inviterDisplayId, 3, 11);
              const passwordOk = password.length >= 6;
              const genderOk = gender !== null;
              return (
                <>
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] uppercase tracking-widest flex items-center gap-2">
                      <span className="text-slate-500">邀请人 ID · 必填</span>
                      {inviterOk ? (
                        <span className="text-emerald-600 normal-case tracking-normal">✓ 已填写</span>
                      ) : (
                        <span className="text-rose-600 normal-case tracking-normal">请填写 3-11 位数字</span>
                      )}
                    </span>
                    <div className="flex gap-2">
                      <input
                        type="text" inputMode="numeric" value={inviterDisplayId}
                        onChange={(e) => setInviterDisplayId(e.target.value.replace(/\D/g, "").slice(0, 11))}
                        placeholder={`朋友的 ID · 或 ${officialId} 走官方通道`}
                        className={`flex-1 rounded-lg border-2 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none font-mono transition ${
                          check.status === "bad"
                            ? "border-rose-400 focus:border-rose-500"
                            : check.status === "ok"
                            ? "border-emerald-400 focus:border-emerald-500"
                            : inviterOk
                            ? "border-emerald-300 focus:border-emerald-500"
                            : "border-rose-300 focus:border-rose-500"
                        }`}
                      />
                      <button
                        type="button"
                        onClick={runCheck}
                        disabled={!inviterOk || check.status === "checking"}
                        title="检查邀请人是否可用"
                        className="shrink-0 w-14 rounded-lg border border-sky-300 bg-sky-100 hover:bg-sky-200 disabled:opacity-30 disabled:cursor-not-allowed text-xs font-semibold text-sky-700 transition"
                      >
                        {check.status === "checking" ? "…" : "🔍 检查"}
                      </button>
                    </div>
                    {check.status !== "idle" && (
                      <p className={`text-[10px] leading-relaxed mt-0.5 ${
                        check.status === "ok" ? "text-emerald-600"
                        : check.status === "bad" ? "text-rose-600"
                        : "text-slate-500"
                      }`}>
                        {check.status === "checking" ? "查询中…" : check.message}
                      </p>
                    )}
                  </label>

                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] uppercase tracking-widest flex items-center gap-2">
                      <span className="text-slate-500">密码 · 必填</span>
                      {passwordOk ? (
                        <span className="text-emerald-600 normal-case tracking-normal">✓ 已填写</span>
                      ) : (
                        <span className="text-rose-600 normal-case tracking-normal">请填写至少 6 位</span>
                      )}
                    </span>
                    <input
                      type="password" value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="至少 6 位"
                      autoComplete="new-password"
                      className={`rounded-lg border-2 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none transition ${
                        passwordOk
                          ? "border-emerald-300 focus:border-emerald-500"
                          : "border-rose-300 focus:border-rose-500"
                      }`}
                    />
                  </label>

                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] uppercase tracking-widest flex items-center gap-2">
                      <span className="text-slate-500">性别 · 必填</span>
                      {genderOk ? (
                        <span className="text-emerald-600 normal-case tracking-normal">✓ 已选</span>
                      ) : (
                        <span className="text-rose-600 normal-case tracking-normal">请选择</span>
                      )}
                      <span className="text-slate-400 normal-case tracking-normal ml-auto">注册后如需修改需联系客服</span>
                    </span>
                    <div className={`flex gap-1.5 rounded-lg border-2 p-1 transition ${
                      genderOk ? "border-emerald-300 bg-emerald-50" : "border-rose-300 bg-rose-50"
                    }`}>
                      {([
                        { code: "female",  label: "女生", emoji: "👩" },
                        { code: "male",    label: "男生", emoji: "👨" },
                        { code: "private", label: "保密", emoji: "🔒" },
                      ] as { code: NameGender; label: string; emoji: string }[]).map((g) => (
                        <button
                          key={g.code}
                          type="button"
                          onClick={() => setGender(g.code)}
                          className={`flex-1 py-2 text-xs font-medium rounded-md transition flex items-center justify-center gap-1 ${
                            gender === g.code
                              ? "bg-sky-500 text-white shadow shadow-sky-500/30"
                              : "text-slate-600 hover:bg-white"
                          }`}
                        >
                          <span className="text-base">{g.emoji}</span>
                          <span>{g.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] text-slate-500 uppercase tracking-widest flex items-center gap-2">
                      昵称
                      <span className="text-slate-400 normal-case tracking-normal">可自动生成 · 也可手改</span>
                    </span>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value.slice(0, 16))}
                        placeholder={gender ? "点右侧🎲随机" : "先选性别"}
                        disabled={!gender}
                        className={`flex-1 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-sky-400 disabled:opacity-40 transition ${
                          rolling ? "animate-pulse" : ""
                        }`}
                      />
                      <button
                        type="button"
                        onClick={handleRoll}
                        disabled={!gender || rolling}
                        title="换一批"
                        className={`shrink-0 w-12 rounded-lg border border-sky-300 bg-sky-100 hover:bg-sky-200 disabled:opacity-30 disabled:cursor-not-allowed text-xl transition ${
                          rolling ? "animate-spin" : ""
                        }`}
                      >
                        🎲
                      </button>
                    </div>
                  </div>
                </>
              );
            })()}

            <div className="pt-2">
              <div className="flex items-baseline justify-between mb-1">
                <span className="text-[10px] text-slate-500 uppercase tracking-widest">联络方式</span>
                <span className="text-[10px] text-slate-500">选填 · 用于找回账号</span>
              </div>
              <div className="flex gap-1.5 rounded-lg bg-slate-100 border border-slate-200 p-1">
                <button type="button"
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md transition ${contactType === "phone" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
                  onClick={() => { setContactType("phone"); setContact(""); }}
                >手机号</button>
                <button type="button"
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md transition ${contactType === "email" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
                  onClick={() => { setContactType("email"); setContact(""); }}
                >邮箱</button>
                <button type="button"
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md transition ${contactType === "skip" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
                  onClick={() => { setContactType("skip"); setContact(""); }}
                >跳过</button>
              </div>
              {contactType !== "skip" ? (
                <input
                  type={contactType === "email" ? "email" : "tel"}
                  inputMode={contactType === "phone" ? "numeric" : "email"}
                  value={contact}
                  onChange={(e) => setContact(contactType === "phone" ? e.target.value.replace(/\D/g, "").slice(0, 11) : e.target.value)}
                  placeholder={contactType === "phone" ? "手机号(11 位 · 不发短信)· 选填" : "邮箱(用于接收通知)· 选填"}
                  className="w-full mt-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-sky-400"
                />
              ) : (
                <p className="mt-1.5 text-[10px] text-amber-700 leading-relaxed px-1">
                  ⚠ 跳过后 · 请务必记住 ID + 密码 · 忘了将无法找回
                </p>
              )}
            </div>

            {error && <p className="text-rose-600 text-xs text-center font-medium">{error}</p>}

            <button type="button" onClick={handleRegisterClick} disabled={busy}
              className="rounded-2xl bg-gradient-to-r from-sky-400 via-cyan-400 to-amber-400 hover:from-sky-500 hover:via-cyan-500 hover:to-amber-500 text-white px-8 py-3 text-sm font-semibold transition shadow-lg shadow-amber-500/30 disabled:opacity-40"
            >
              {busy ? "提交中…" : "申请注册"}
            </button>

            <p className="text-[10px] text-slate-500 text-center leading-relaxed">
              填 <span className="font-mono text-slate-700">{officialId}</span> 走官方通道自动通过
              <br/>填朋友的 ID 需要 TA 在 2 分钟内确认
            </p>
          </div>
        )}

        {mode === "login" && (
          <form onSubmit={handleLogin} className="flex flex-col gap-3">
            <input
              type="text" value={loginId} onChange={(e) => setLoginId(e.target.value)}
              placeholder="邮箱 / 手机号 / ID"
              autoComplete="username"
              className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-sky-400"
            />
            <input
              type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)}
              placeholder="密码"
              autoComplete="current-password"
              className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-sky-400"
            />
            {error && <p className="text-rose-600 text-xs text-center font-medium">{error}</p>}
            <button type="submit" disabled={busy}
              className="rounded-xl px-8 py-3 font-semibold text-sm transition bg-gradient-to-r from-sky-500 to-cyan-500 hover:from-sky-600 hover:to-cyan-600 text-white shadow-lg shadow-sky-500/30 disabled:opacity-30"
            >
              {busy ? "处理中…" : "登录"}
            </button>
          </form>
        )}
      </div>

      {showPreSubmit && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center px-4" onClick={() => setShowPreSubmit(false)}>
          <div className="w-full max-w-sm rounded-3xl bg-white border border-slate-200 shadow-2xl shadow-sky-500/10 p-6 flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
            <div className="text-center">
              <div className="text-3xl mb-2">⏱️</div>
              <h3 className="text-lg font-semibold text-slate-900">2 分钟同步窗口</h3>
              <p className="text-slate-600 text-xs mt-2">提交后邀请人有 2 分钟审核。 建议:</p>
            </div>
            <ul className="text-sm text-slate-700 space-y-2 pl-2">
              <li>• 提前电话/微信联系邀请人</li>
              <li>• 让 TA 打开 QVideoChat 并登录</li>
              <li>• 提交时对方能立即看到</li>
            </ul>
            <p className="text-[10px] text-slate-500 text-center">如果不方便同步,可以先游客模式匹配,再在通话中让对方邀请你</p>
            <div className="flex flex-col gap-2 mt-2">
              <button type="button" onClick={submitRegister}
                className="w-full rounded-2xl bg-gradient-to-r from-sky-400 via-cyan-400 to-amber-400 hover:from-sky-500 hover:via-cyan-500 hover:to-amber-500 text-white px-6 py-2.5 text-sm font-semibold transition shadow shadow-amber-500/30"
              >我已联系好,提交</button>
              <button type="button" onClick={() => setShowPreSubmit(false)}
                className="text-xs text-slate-500 hover:text-slate-800 py-2"
              >再想想</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <main className="flex min-h-screen flex-col items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-sky-600" />
      </main>
    }>
      <LoginForm />
    </Suspense>
  );
}
