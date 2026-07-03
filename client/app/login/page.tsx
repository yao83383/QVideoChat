"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/hooks/useUser";

export default function LoginPage() {
  const router = useRouter();
  const { user, doLogin, doSignup } = useUser();
  const [tab, setTab] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!email || !password) { setError("请填写邮箱和密码"); return; }
    if (tab === "register" && !username.trim()) { setError("请输入昵称"); return; }
    if (password.length < 6) { setError("密码至少6位"); return; }

    setLoading(true);
    try {
      if (tab === "register") {
        await doSignup(username.trim(), email, password);
      } else {
        await doLogin(email, password);
      }
      router.push("/");
    } catch (e: any) {
      setError(e.message || "操作失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
      <button
        onClick={() => router.push("/")}
        className="absolute top-4 left-4 text-xs text-neutral-400 hover:text-white transition"
      >
        &larr; 返回
      </button>

      <h1 className="text-xl font-bold">QVideoChat</h1>

      <div className="flex border-b border-neutral-800 w-64">
        <button
          className={`flex-1 py-2 text-sm font-medium transition ${
            tab === "login" ? "text-white border-b-2 border-white" : "text-neutral-500"
          }`}
          onClick={() => setTab("login")}
        >
          登录
        </button>
        <button
          className={`flex-1 py-2 text-sm font-medium transition ${
            tab === "register" ? "text-white border-b-2 border-white" : "text-neutral-500"
          }`}
          onClick={() => setTab("register")}
        >
          注册
        </button>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4 w-64">
        {tab === "register" && (
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="昵称"
            maxLength={12}
            className="rounded-lg border border-neutral-700 bg-neutral-800 px-4 py-2.5 text-sm text-white placeholder-neutral-500 outline-none focus:border-neutral-500"
          />
        )}
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="邮箱"
          className="rounded-lg border border-neutral-700 bg-neutral-800 px-4 py-2.5 text-sm text-white placeholder-neutral-500 outline-none focus:border-neutral-500"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="密码"
          className="rounded-lg border border-neutral-700 bg-neutral-800 px-4 py-2.5 text-sm text-white placeholder-neutral-500 outline-none focus:border-neutral-500"
        />

        {error && <p className="text-red-400 text-xs text-center">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="rounded-xl px-8 py-3 font-semibold text-sm transition bg-white text-black hover:bg-neutral-200 disabled:opacity-30"
        >
          {loading ? "处理中..." : tab === "register" ? "注册" : "登录"}
        </button>

        <p className="text-xs text-neutral-500 text-center">
          {tab === "register"
            ? "注册后解锁好友系统和社交功能"
            : "登录后同步你的好友和数据"
          }
        </p>
      </form>
    </main>
  );
}
