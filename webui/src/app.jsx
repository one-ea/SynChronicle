import React, { useEffect, useMemo, useState } from "react";
import Studio from "./studio.jsx";

const PAGES = ["home", "book", "reader", "login", "studio"];

function parseRoute() {
  const path = window.location.pathname;
  if (path.startsWith("/studio")) return { page: "studio" };
  if (path.startsWith("/login")) return { page: "login", next: new URLSearchParams(window.location.search).get("next") || "/studio" };
  const params = new URLSearchParams(window.location.search);
  const book = params.get("book");
  const chapter = params.get("ch");
  if (book && chapter) return { page: "reader", book, chapter: Number(chapter) };
  if (book) return { page: "book", book };
  return { page: "home" };
}

export function navigate(href) { window.history.pushState({}, "", href); window.dispatchEvent(new PopStateEvent("popstate")); }

async function api(path) {
  const response = await fetch(path, { headers: { "x-requested-with": "fetch" } });
  if (response.status === 401) { navigate("/login?next=/studio"); throw new Error("未登录"); }
  return response.json();
}

export default function App() {
  const [route, setRoute] = useState(parseRoute);
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    const onPop = () => setRoute(parseRoute());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const toggleTheme = () => { const next = !dark; setDark(next); document.documentElement.classList.toggle("dark", next); try { localStorage.setItem("theme", next ? "dark" : "light"); } catch { /* ignore */ } };
  if (!PAGES.includes(route.page)) return null;
  return (
    <>
      <header className="nav">
        <a className="brand" href="/" onClick={(event) => { event.preventDefault(); navigate("/"); }}>S<em>—</em><small>书城</small></a>
        <div className="nav-actions">
          <button className="btn btn-tonal" type="button" onClick={toggleTheme}>{dark ? "Light" : "Dark"}</button>
          <a className="btn btn-filled" href="/studio" onClick={(event) => { event.preventDefault(); navigate("/studio"); }}>创作控制台</a>
        </div>
      </header>
      {route.page === "home" && <Home />}
      {route.page === "book" && <BookDetail id={route.book} />}
      {route.page === "reader" && <Reader id={route.book} chapter={route.chapter} />}
      {route.page === "login" && <Login next={route.next} />}
      {route.page === "studio" && <Studio />}
      <footer className="footer">SynChronicle · AI 多 Agent 小说引擎 · 本站内容含 AI 生成标识</footer>
    </>
  );
}

function Home() {
  const [entries, setEntries] = useState(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("new");
  useEffect(() => { api("/api/shelf").then((data) => setEntries(data.entries ?? [])).catch(() => setEntries([])); }, []);
  const filtered = useMemo(() => {
    const list = (entries ?? []).filter((entry) => !query || entry.title.includes(query) || (entry.tags ?? []).some((tag) => tag.includes(query)));
    const sorted = [...list];
    if (sort === "new") sorted.sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
    if (sort === "words") sorted.sort((a, b) => (b.stats?.words ?? 0) - (a.stats?.words ?? 0));
    if (sort === "chapters") sorted.sort((a, b) => (b.stats?.chapters ?? 0) - (a.stats?.chapters ?? 0));
    return sorted;
  }, [entries, query, sort]);
  if (entries === null) return <main className="wrap"><div className="empty">加载中…</div></main>;
  return (
    <main className="wrap">
      <section className="hero"><h1>发现故事</h1><p>正在连载与已经完成的 AI 协作作品，点击即读。</p></section>
      <div className="toolbar">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索书名或标签" aria-label="搜索书名或标签" />
        <select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="排序方式">
          <option value="new">最新发布</option>
          <option value="words">字数最多</option>
          <option value="chapters">章节最多</option>
        </select>
      </div>
      {filtered.length === 0 ? <div className="empty">还没有符合条件的作品——去控制台写下第一本吧。</div> : (
        <div className="grid">
          {filtered.map((entry) => (
            <article key={entry.id} className="card" onClick={() => navigate(`/read?book=${encodeURIComponent(entry.id)}`)} role="link" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") navigate(`/read?book=${encodeURIComponent(entry.id)}`); }}>
              <div className="cover" style={{ "--hue": entry.hue ?? 24 }} />
              <h2>{entry.title}</h2>
              <div className="meta">{entry.authorName} · {entry.stats?.chapters ?? 0} 章 · {(entry.stats?.words ?? 0).toLocaleString("zh-CN")} 字</div>
              {(entry.tags ?? []).map((tag) => <span key={tag} className="tag">{tag}</span>)}
            </article>
          ))}
        </div>
      )}
    </main>
  );
}

function BookDetail({ id }) {
  const [data, setData] = useState(null);
  useEffect(() => { api(`/api/shelf/${encodeURIComponent(id)}`).then(setData).catch(() => setData({ entry: null, chapters: [] })); }, [id]);
  if (!data) return <main className="wrap"><div className="empty">加载中…</div></main>;
  if (!data.entry) return <main className="wrap"><div className="empty">书籍不存在或未公开。</div></main>;
  const { entry, chapters } = data;
  return (
    <main className="wrap">
      <div className="detail">
        <a className="btn btn-tonal" href="/read" onClick={(event) => { event.preventDefault(); navigate("/"); }}>← 返回书城</a>
        <h1 style={{ marginTop: 18 }}>{entry.title}</h1>
        <p className="meta">{entry.authorName} · {entry.synopsis}</p>
        {(entry.tags ?? []).map((tag) => <span key={tag} className="tag">{tag}</span>)}
        {entry.aigcLabel ? <span className="aigc">AI 生成内容</span> : null}
        <div className="toc">
          {chapters.length === 0 ? <div className="empty">暂无已完结章节。</div> : chapters.map((chapter) => (
            <button key={chapter.chapter} className="toc-row" type="button" onClick={() => navigate(`/read?book=${encodeURIComponent(id)}&ch=${chapter.chapter}`)}>
              <span>第 {chapter.chapter} 章 · {chapter.title}</span>
              <small>{chapter.words.toLocaleString("zh-CN")} 字</small>
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}

function Reader({ id, chapter }) {
  const [data, setData] = useState(null);
  useEffect(() => { api(`/api/shelf/${encodeURIComponent(id)}/chapters/${chapter}`).then(setData).catch(() => setData(null)); }, [id, chapter]);
  if (data === null) return <main className="wrap"><div className="empty">加载中…</div></main>;
  if (!data.title) return <main className="wrap"><div className="empty">章节不存在或尚未完成。</div></main>;
  return (
    <main className="wrap">
      <div className="reader">
        <a className="btn btn-tonal" href={`/read?book=${id}`} onClick={(event) => { event.preventDefault(); navigate(`/read?book=${encodeURIComponent(id)}`); }}>← 返回目录</a>
        <h1 style={{ marginTop: 18 }}>{data.title}</h1>
        <div className="chapter-text">{data.text}</div>
        <div className="pager">
          {data.prev ? <a className="btn btn-tonal" href={`/read?book=${id}&ch=${data.prev}`} onClick={(event) => { event.preventDefault(); navigate(`/read?book=${encodeURIComponent(id)}&ch=${data.prev}`); }}>上一章</a> : <span />}
          {data.next ? <a className="btn btn-filled" href={`/read?book=${id}&ch=${data.next}`} onClick={(event) => { event.preventDefault(); navigate(`/read?book=${encodeURIComponent(id)}&ch=${data.next}`); }}>下一章</a> : <span />}
        </div>
      </div>
    </main>
  );
}

function Login({ next }) {  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const submit = async (event) => {
    event.preventDefault();
    setError("");
    const response = await fetch("/api/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-requested-with": "fetch" }, body: JSON.stringify({ name, password }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { setError(data.error || "登录失败"); return; }
    navigate(next);
    window.location.reload();
  };
  return (
    <main className="wrap">
      <div className="login">
        <h1>登录 SynChronicle</h1>
        <p>使用创作账号进入控制台。</p>
        <form onSubmit={submit}>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="用户名" autoComplete="username" aria-label="用户名" required minLength={2} maxLength={32} />
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="密码" autoComplete="current-password" aria-label="密码" required minLength={8} />
          {error ? <div className="meta" style={{ color: "var(--error)" }}>{error}</div> : null}
          <button className="btn btn-filled" type="submit">登录</button>
        </form>
      </div>
    </main>
  );
}
