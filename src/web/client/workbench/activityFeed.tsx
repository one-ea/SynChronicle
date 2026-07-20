import type { RunEventMessage, RunViewState } from "../realtime/useRunEvents.js";
import type { WorkbenchChapter } from "../pages/workbench.js";

function eventLabel(event: RunEventMessage) {
  if (event.type === "reflection") return "反思评审";
  if (event.type === "error") return "运行错误";
  if (event.type === "stream.delta" || event.type === "stream" || event.type === "stream_delta") return "正文增量";
  const payload = event.payload && typeof event.payload === "object" ? event.payload as Record<string, unknown> : {};
  return event.agent ?? (typeof payload.agent === "string" ? payload.agent : event.type);
}

interface ActivityFeedBaseProps {
  state: RunViewState;
  chapter?: WorkbenchChapter;
}

type ActivityFeedProps = ActivityFeedBaseProps & (
  | { runSummary: { status: string; score?: number; connectionError?: string; operationError?: string | null }; onOpenRun(): void }
  | { runSummary?: undefined; onOpenRun?: undefined }
);

export function ActivityFeed({ state, chapter, runSummary, onOpenRun }: ActivityFeedProps) {
  return <main className="workbench-panel activity-panel" id="main-content" tabIndex={-1}>
    <header className="panel-heading activity-heading">
      <div><p className="eyebrow">Live writing</p><h1>创作流</h1></div>
      <span className="event-count" title="当前保留最近 200 条事件">{state.events.length} 条事件</span>
    </header>
    {runSummary ? <button className={`mobile-run-summary${runSummary.connectionError || runSummary.operationError ? " mobile-run-summary-error" : ""}`} type="button" aria-label={`${runSummary.connectionError || runSummary.operationError ? "查看运行错误" : "查看运行状态"}：${runSummary.connectionError ?? runSummary.operationError ?? runSummary.status}${runSummary.score !== undefined ? `，${runSummary.score} 分` : ""}`} onClick={onOpenRun}>
      <span>{runSummary.connectionError ?? runSummary.status}</span>
      {runSummary.score !== undefined ? <strong>{runSummary.score} 分</strong> : null}
      {runSummary.operationError ? <small>{runSummary.operationError}</small> : null}
      <span aria-hidden="true">›</span>
    </button> : null}
    <div className="activity-scroll" data-scroll-key="writing">
      {chapter && <article className="chapter-reader" aria-labelledby="chapter-reader-title">
        <p className="section-number">Chapter {String(chapter.sequence).padStart(2, "0")}</p>
        <h2 id="chapter-reader-title">{chapter.title}</h2>
        {chapter.body ? <p>{chapter.body}</p> : <p className="muted-copy">这一章仍在等待正文。</p>}
      </article>}
      {state.stream && <article className="stream-card" aria-live="polite"><p className="section-number">实时正文</p><p>{state.stream}</p></article>}
      {state.events.length === 0 ? <section className="feed-empty"><h2>等待第一行文字</h2><p>运行事件会按发生顺序出现在这里。</p></section> : <ol className="event-list">
        {state.events.filter((event) => !["stream.delta", "stream", "stream_delta"].includes(event.type)).map((event) => <li key={event.sequence}>
          <span className={`event-marker event-${event.type}`} aria-hidden="true" />
          <div><small>{eventLabel(event)} · #{event.sequence}</small><p>{event.message ?? "运行状态已更新"}</p></div>
        </li>)}
      </ol>}
    </div>
  </main>;
}
