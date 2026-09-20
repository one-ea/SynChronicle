import React, { useCallback, useEffect, useRef, useState } from "react";

/** P11-C10 创作工作台：autopilot 流式生成 + 书籍管理 + 一致性记忆 + 评审报告 + 发布。 */

async function post(path, body) {
  const response = await fetch(path, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-requested-with": "fetch" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败 ${response.status}`);
  return data;
}

async function get(path) {
  const response = await fetch(path, { headers: { "x-requested-with": "fetch" } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败 ${response.status}`);
  return data;
}

/** 解析 SSE 字节流为事件序列（POST 响应同样适用）。 */
async function readSse(body, onEvent) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const eventLine = block.split("\n").find((line) => line.startsWith("event:"));
      const dataLine = block.split("\n").find((line) => line.startsWith("data:"));
      if (eventLine && dataLine) {
        try { onEvent(eventLine.slice(6).trim(), JSON.parse(dataLine.slice(5).trim())); } catch { /* 跳过坏块 */ }
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
}

export default function Studio() {
  const [ready, setReady] = useState(null);
  const [shell, setShell] = useState(null);
  useEffect(() => {
    fetch("/api/auth/me", { headers: { "x-requested-with": "fetch" } }).then((response) => setReady(response.ok)).catch(() => setReady(false));
    fetch("/api/shell").then((response) => response.json()).then(setShell).catch(() => setShell(null));
  }, []);
  if (ready === null) return <main className="wrap"><div className="empty">加载中…</div></main>;
  if (!ready) { setTimeout(() => { window.location.href = "/login?next=/studio"; }, 0); return <main className="wrap"><div className="empty">跳转登录…</div></main>; }
  // runtime=worker 时启用边缘专属面板（compose/autopilot/记忆/评审）；Node 主线走 /studio/legacy 完整控制台
  const edge = shell?.runtime === "worker";
  return (
    <main className="wrap">
      {edge ? <Workbench mode={shell?.mode} /> : <iframe className="studio-frame" title="SynChronicle 控制台" src="/studio/legacy" />}
    </main>
  );
}

function Workbench({ mode }) {
  const [books, setBooks] = useState([]);
  const [active, setActive] = useState("");
  const [notice, setNotice] = useState("");
  const loadBooks = useCallback(() => {
    get("/api/books").then((data) => {
      const list = data.books ?? [];
      setBooks(list);
      setActive((current) => current || data.activeId || list[0]?.id || "");
    }).catch(() => setBooks([]));
  }, []);
  useEffect(() => { loadBooks(); }, [loadBooks]);
  const flash = (message) => { setNotice(message); setTimeout(() => setNotice(""), 4000); };
  return (
    <>
      <section className="card">
        <h2>创作工作台</h2>
        <p className="meta">{mode === "commercial" ? "商用模式：按模型用量计费" : "自用模式：免计费"}{notice ? ` · ${notice}` : ""}</p>
        <BookPicker books={books} active={active} onPick={setActive} onCreated={() => { loadBooks(); flash("书籍已创建"); }} onError={flash} />
      </section>
      {active ? (
        <>
          <AutopilotPanel bookId={active} flash={flash} />
          <MemoryPanel bookId={active} flash={flash} />
          <ReviewPanel bookId={active} />
          <PublishPanel bookId={active} flash={flash} />
        </>
      ) : (
        <section className="card"><p className="meta">先创建或选择一本书籍。</p></section>
      )}
    </>
  );
}

function BookPicker({ books, active, onPick, onCreated, onError }) {
  const [title, setTitle] = useState("");
  const create = async (event) => {
    event.preventDefault();
    if (!title.trim()) return;
    try {
      await post("/api/import", { title: title.trim(), text: "第1章 开端\n\n（空白起点）" });
      setTitle("");
      onCreated();
    } catch (error) {
      onError(error.message);
    }
  };
  return (
    <div className="row">
      <label>书籍</label>
      <select value={active} onChange={(event) => onPick(event.target.value)} aria-label="选择书籍">
        {(books ?? []).map((book) => <option key={book.id} value={book.id}>{book.title}</option>)}
      </select>
      <form onSubmit={create} className="row">
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="新书标题" aria-label="新书标题" maxLength={40} />
        <button className="btn btn-tonal" type="submit">创建</button>
      </form>
    </div>
  );
}

const PHASES = ["idle", "planning", "writing", "reviewing", "rewriting", "done", "failed"];
function AutopilotPanel({ bookId, flash }) {
  const [premise, setPremise] = useState("");
  const [chapters, setChapters] = useState(3);
  const [threshold, setThreshold] = useState(85);
  const [phase, setPhase] = useState("idle");
  const [log, setLog] = useState([]);
  const [live, setLive] = useState("");
  const [report, setReport] = useState(null);
  const logRef = useRef(null);
  const push = (line) => setLog((current) => [...current.slice(-40), line]);
  const start = async () => {
    if (!premise.trim()) { flash("请先填写创作需求"); return; }
    setPhase("planning"); setLog([]); setLive(""); setReport(null);
    try {
      const response = await fetch("/api/autopilot", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-requested-with": "fetch" }, body: JSON.stringify({ bookId, premise: premise.trim(), chapters: Number(chapters), scoreThreshold: Number(threshold) }) });
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `启动失败 ${response.status}`);
      }
      await readSse(response.body, (event, data) => {
        if (event === "plan") { setPhase("writing"); push(`策划完成：${(data.chapters ?? []).map((item) => item.title).join("、")}`); }
        else if (event === "delta") { setLive((current) => (current.length > 4000 ? "" : current) + (data.value ?? "")); }
        else if (event === "review") { setPhase(data.round === 0 ? "reviewing" : "rewriting"); setReport(data); push(`评审第 ${data.round + 1} 轮：${data.score ?? "?"} 分 — ${data.verdict ?? ""}`); }
        else if (event === "rewrite") { setPhase("rewriting"); push(`重写章节：${(data.chapters ?? []).join("、")}`); }
        else if (event === "done") { setPhase("done"); setLive(""); setReport(data); push(`完成：最终 ${data.finalScore ?? "?"} 分（${data.passed ? "达标" : "未达标"}），${data.rounds} 轮`); flash("自动驾驶完成"); }
        else if (event === "error") { setPhase("failed"); push(`错误：${data.message ?? "未知"}`); }
      });
      // 兜底：流正常关闭但未收到 done/error（如网关截断）时复位运行态；函数式更新避免 stale closure
      setPhase((current) => (current === "planning" || current === "writing" || current === "reviewing" || current === "rewriting") ? "done" : current);
    } catch (error) {
      setPhase("failed");
      push(`错误：${error.message}`);
    }
  };
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [log]);
  return (
    <section className="card">
      <h2>自动驾驶</h2>
      <p className="meta">策划 → 带记忆写作 → 评审，未达标自动重写（每轮计入额度）。</p>
      <textarea value={premise} onChange={(event) => setPremise(event.target.value)} placeholder="一句话创作需求：例如「雨夜书局的掌柜发现一本会自己翻页的残卷」" rows={3} aria-label="创作需求" maxLength={4000} />
      <div className="row">
        <label>章节数</label>
        <input type="number" min="1" max="12" value={chapters} onChange={(event) => setChapters(event.target.value)} aria-label="章节数" />
        <label>达标分</label>
        <input type="number" min="50" max="100" value={threshold} onChange={(event) => setThreshold(event.target.value)} aria-label="达标分" />
        <button className="btn btn-filled" type="button" disabled={phase !== "idle" && phase !== "done" && phase !== "failed"} onClick={start}>{phase === "idle" || phase === "done" || phase === "failed" ? "启动" : `${PHASES.includes(phase) ? phase : "运行中"}…`}</button>
      </div>
      {live ? <pre className="live-draft">{live.slice(-1200)}</pre> : null}
      <ol className="run-log" ref={logRef}>{log.map((line, index) => <li key={index}>{line}</li>)}</ol>
    </section>
  );
}

function MemoryPanel({ bookId, flash }) {
  const [characters, setCharacters] = useState([]);
  const [foreshadows, setForeshadows] = useState([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [foreshadowTitle, setForeshadowTitle] = useState("");
  const [foreshadowNote, setForeshadowNote] = useState("");
  const reload = useCallback(() => {
    get(`/api/entities?book=${encodeURIComponent(bookId)}`).then((data) => setCharacters(data.entities ?? [])).catch(() => setCharacters([]));
    get(`/api/foreshadows?book=${encodeURIComponent(bookId)}`).then((data) => setForeshadows(data.items ?? [])).catch(() => setForeshadows([]));
  }, [bookId]);
  useEffect(() => { reload(); }, [reload]);
  const addCharacter = async (event) => {
    event.preventDefault();
    if (!name.trim()) return;
    try {
      await post("/api/entities", { bookId, entity: { id: `c-${Date.now().toString(36)}`, name: name.trim(), type: "character", description: description.trim() } });
      setName(""); setDescription(""); reload(); flash("角色已登记");
    } catch (error) {
      flash(error.message);
    }
  };
  const addForeshadow = async (event) => {
    event.preventDefault();
    if (!foreshadowTitle.trim()) return;
    try {
      await post("/api/foreshadows", { bookId, foreshadow: { id: `f-${Date.now().toString(36)}`, title: foreshadowTitle.trim(), description: foreshadowNote.trim(), plantedChapter: 1, urgency: "medium" } });
      setForeshadowTitle(""); setForeshadowNote(""); reload(); flash("伏笔已登记");
    } catch (error) {
      flash(error.message);
    }
  };
  return (
    <section className="card">
      <h2>一致性记忆</h2>
      <p className="meta">写作时自动注入：前文摘要、角色状态、未回收伏笔。</p>
      <div className="memory-grid">
        <div>
          <h3>角色（{characters.length}）</h3>
          <ul>{characters.map((character) => <li key={character.id}>{character.name} — {character.description}</li>)}</ul>
          <form onSubmit={addCharacter} className="stack">
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="角色名" aria-label="角色名" maxLength={30} />
            <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="一句话设定" aria-label="角色设定" maxLength={100} />
            <button className="btn btn-tonal" type="submit">登记角色</button>
          </form>
        </div>
        <div>
          <h3>伏笔（{foreshadows.filter((item) => item.stage !== "resolved").length} 未回收）</h3>
          <ul>{foreshadows.map((item) => <li key={item.id}>{item.title}（{item.stage}）— {item.description}</li>)}</ul>
          <form onSubmit={addForeshadow} className="stack">
            <input value={foreshadowTitle} onChange={(event) => setForeshadowTitle(event.target.value)} placeholder="伏笔名" aria-label="伏笔名" maxLength={40} />
            <input value={foreshadowNote} onChange={(event) => setForeshadowNote(event.target.value)} placeholder="回收线索" aria-label="回收线索" maxLength={80} />
            <button className="btn btn-tonal" type="submit">登记伏笔</button>
          </form>
        </div>
      </div>
    </section>
  );
}

function ReviewPanel({ bookId }) {
  const [reports, setReports] = useState([]);
  useEffect(() => {
    get(`/api/reviews?book=${encodeURIComponent(bookId)}`).then((data) => setReports(data.reports ?? [])).catch(() => setReports([]));
  }, [bookId]);
  if (!reports.length) return null;
  return (
    <section className="card">
      <h2>评审报告</h2>
      <ul className="review-list">
        {reports.map((item) => (
          <li key={item.id}>
            <strong>{item.score !== null ? `${item.score} 分` : "未评分"}</strong> · {item.verdict}
            {(item.issues ?? []).length ? <small>（{item.issues.map((issue) => `第 ${issue.chapter} 章 ${issue.note}`).join("；")}）</small> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function PublishPanel({ bookId, flash }) {
  const [title, setTitle] = useState("");
  const [synopsis, setSynopsis] = useState("");
  const publish = async (event) => {
    event.preventDefault();
    try {
      await post("/api/publish", { bookId, title: title.trim() || undefined, synopsis: synopsis.trim() || undefined, visibility: "public" });
      flash("已发布到书城");
      setTitle(""); setSynopsis("");
    } catch (error) {
      flash(error.message);
    }
  };
  return (
    <section className="card">
      <h2>发布</h2>
      <p className="meta">发布内容自动携带 AI 生成标识；商用模式发布前强制安全扫描。</p>
      <form onSubmit={publish} className="stack">
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="书名（默认用书籍名）" aria-label="书名" maxLength={60} />
        <input value={synopsis} onChange={(event) => setSynopsis(event.target.value)} placeholder="一句话简介" aria-label="简介" maxLength={300} />
        <button className="btn btn-filled" type="submit">发布到书城</button>
      </form>
    </section>
  );
}
