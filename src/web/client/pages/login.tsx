import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, type ApiClient } from "../api/client.js";
import { useSession, type SessionUser } from "../auth/session.js";

interface LoginPageProps {
  api: ApiClient;
  onAuthenticated(): Promise<void>;
}

export function LoginPage({ api, onAuthenticated }: LoginPageProps) {
  const session = useSession();
  const usernameRef = useRef<HTMLInputElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => usernameRef.current?.focus(), []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    try {
      const result = await api.request<{ user: SessionUser }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: data.get("username"), password: data.get("password") }),
      });
      session.establish(result.user);
      await onAuthenticated();
      window.history.replaceState({}, "", "/projects");
    } catch (caught) {
      const requestId = caught instanceof ApiError && caught.requestId ? ` 请求 ID：${caught.requestId}` : "";
      setError(`用户名或密码不正确。${requestId}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page" id="main-content">
      <section className="login-intro" aria-labelledby="login-title">
        <p className="eyebrow">SynChronicle · AI literary studio</p>
        <h1 id="login-title">继续你的故事</h1>
        <p className="lede">让构思、写作与编辑保持在同一条清晰的叙事线上。</p>
        <blockquote>“每一部作品，都从一次安静的回到书桌开始。”</blockquote>
      </section>
      <section className="login-panel" aria-label="账户登录">
        <p className="section-number" aria-hidden="true">01 / 进入书房</p>
        <h2>登录</h2>
        <form onSubmit={submit} noValidate>
          <label htmlFor="username">用户名</label>
          <input ref={usernameRef} id="username" name="username" autoComplete="username" required />
          <label htmlFor="password">密码</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required />
          {error && <p className="message message-error" role="alert">{error}</p>}
          <button className="button button-primary" type="submit" disabled={submitting}>
            {submitting ? "正在登录" : "登录"}
          </button>
        </form>
      </section>
    </main>
  );
}
