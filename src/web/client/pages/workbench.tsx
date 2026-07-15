import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { ApiClient } from "../api/client.js";
import { useRunEvents, type ConnectionState, type RunEventMessage } from "../realtime/useRunEvents.js";
import { ActivityFeed } from "../workbench/activityFeed.js";
import { MobileNav, type WorkbenchPanel } from "../workbench/mobileNav.js";
import { ProjectNav } from "../workbench/projectNav.js";
import { PromptInput } from "../workbench/promptInput.js";
import { RunSidebar } from "../workbench/runSidebar.js";

export interface WorkbenchChapter { id: string; runId?: string; sequence: number; title: string; status: string; body: string; version?: number }
export interface WorkbenchProject {
  id: string;
  title: string;
  version?: number;
  chapters?: WorkbenchChapter[];
  latestRun?: { id: string; status: string; version?: number; checkpointVersion?: number | null; waiting_for_durable_commit?: boolean } | null;
  agents?: Array<{ name: string; state: string; summary?: string; sequence?: number }>;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number; cost: string; byAgent: Array<{ agent: string; inputTokens: number; outputTokens: number; totalTokens: number; cost: string }> };
  pendingQuestion?: { id: string; questions: Array<{ header: string; question: string; options: string[] }> } | null;
  modelConfiguration?: {
    activeModelSetId?: string;
    modelSets: Array<{ id: string; name: string; version: number; agents: Record<string, { provider: string; model: string; credentialId?: string; parameters?: Record<string, unknown> }> }>;
    providers: Array<{ provider: string; models: string[]; credentials: Array<{ id: string; label: string }> }>;
  };
}

interface WorkbenchPageProps {
  api: ApiClient;
  project: WorkbenchProject;
  initialEvents?: RunEventMessage[];
  subscribe?: (listener: (event: RunEventMessage) => void) => () => void;
  connectionOverride?: ConnectionState;
}

function initialPanel(): WorkbenchPanel {
  const panel = new URL(window.location.href).searchParams.get("panel");
  return panel === "project" || panel === "status" ? panel : "writing";
}
function commandStorageKey(projectId: string, runId: string) { return `synchronicle:command:${projectId}:${runId}`; }

export function WorkbenchPage({ api, project, initialEvents, subscribe, connectionOverride }: WorkbenchPageProps) {
  const url = new URL(window.location.href);
  const initialRunId = url.searchParams.get("run") ?? project.latestRun?.id ?? undefined;
  const [runId, setRunId] = useState(initialRunId);
  const chapterId = url.searchParams.get("chapter") ?? undefined;
  const [panel, setPanel] = useState<WorkbenchPanel>(initialPanel);
  const [selectedChapter, setSelectedChapter] = useState(() => project.chapters?.find(({ id }) => id === chapterId));
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [leftWidth, setLeftWidth] = useState(280);
  const [rightWidth, setRightWidth] = useState(300);
  const [diagnostics, setDiagnostics] = useState<string | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState(project.pendingQuestion);
  const [abortWaiting, setAbortWaiting] = useState(Boolean(project.latestRun?.waiting_for_durable_commit));
  const [commandFeedback, setCommandFeedback] = useState<string | null>(null);
  const [pendingCommandId, setPendingCommandId] = useState<string | null>(() => initialRunId ? sessionStorage.getItem(commandStorageKey(project.id, initialRunId)) : null);
  const [lastModelSwitch, setLastModelSwitch] = useState<{ role: string; provider: string; model: string; credentialId?: string; parameters?: Record<string, unknown> } | null>(null);
  const scrollPositions = useRef<Record<WorkbenchPanel, number>>({ project: 0, writing: 0, status: 0 });
  const { state, connection } = useRunEvents({ runId, initialEvents, subscribe });
  useEffect(() => {
    const latest = state.events.at(-1);
    const payload = latest?.payload && typeof latest.payload === "object" ? latest.payload as Record<string, unknown> : {};
    const message = typeof payload.message === "string" ? payload.message : latest?.message ?? "";
    if (/完成|cancel|abort|终止/i.test(message)) setAbortWaiting(false);
  }, [state.events]);
  useEffect(() => {
    if (!pendingCommandId) return;
    const command = state.commands[pendingCommandId];
    if (!command) return;
    setCommandFeedback(command.status === "applied" ? "模型切换已在安全边界应用。" : `模型切换失败：${command.message ?? command.category ?? "未知错误"}`);
    if (runId) sessionStorage.removeItem(commandStorageKey(project.id, runId));
    setPendingCommandId(null);
  }, [pendingCommandId, state.commands]);
  useEffect(() => {
    if (!runId) { setPendingCommandId(null); return; }
    setPendingCommandId(sessionStorage.getItem(commandStorageKey(project.id, runId)));
  }, [project.id, runId]);
  useEffect(() => {
    if (!runId || !pendingCommandId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const result = await api.request<{ command: { status: string; retryable: boolean; failureCategory: string | null; errorMessage: string | null } }>(`/api/projects/${project.id}/runs/${runId}/commands/${encodeURIComponent(pendingCommandId)}`);
        if (!active) return;
        if (result.command.status === "applied" || result.command.status === "failed") {
          setCommandFeedback(result.command.status === "applied" ? "模型切换已在安全边界应用。" : `模型切换失败：${result.command.errorMessage ?? result.command.failureCategory ?? "未知错误"}`);
          sessionStorage.removeItem(commandStorageKey(project.id, runId));
          setPendingCommandId(null);
          return;
        }
      } catch { /* WS may still deliver the terminal state. */ }
      if (active) timer = setTimeout(() => void poll(), 5_000);
    };
    void poll();
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [api, connection, connectionOverride, pendingCommandId, project.id, runId]);

  useEffect(() => {
    const current = document.querySelector<HTMLElement>(`[data-panel='${panel}'] .activity-scroll, [data-panel='${panel}']`);
    if (current) current.scrollTop = scrollPositions.current[panel];
  }, [panel]);

  useEffect(() => {
    function restoreHistory() {
      const nextUrl = new URL(window.location.href);
      const nextPanel = nextUrl.searchParams.get("panel");
      const resolvedPanel: WorkbenchPanel = nextPanel === "project" || nextPanel === "status" ? nextPanel : "writing";
      const nextChapter = project.chapters?.find(({ id }) => id === nextUrl.searchParams.get("chapter"));
      setPanel(resolvedPanel);
      setSelectedChapter(nextChapter);
      queueMicrotask(() => document.querySelector<HTMLElement>(`[data-panel='${resolvedPanel}'] button, [data-panel='${resolvedPanel}'] [tabindex='-1']`)?.focus());
    }
    window.addEventListener("popstate", restoreHistory);
    return () => window.removeEventListener("popstate", restoreHistory);
  }, [project.chapters]);

  function selectPanel(next: WorkbenchPanel) {
    const current = document.querySelector<HTMLElement>(`[data-panel='${panel}'] .activity-scroll, [data-panel='${panel}']`);
    scrollPositions.current[panel] = current?.scrollTop ?? 0;
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("panel", next);
    window.history.pushState({}, "", nextUrl);
    setPanel(next);
    queueMicrotask(() => document.querySelector<HTMLElement>(`[data-panel='${next}'] button, [data-panel='${next}'] [tabindex='-1']`)?.focus());
  }

  function selectChapter(chapter: WorkbenchChapter) {
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("chapter", chapter.id);
    window.history.replaceState({}, "", nextUrl);
    setSelectedChapter(chapter);
  }

  async function steer(instruction: string) {
    if (!runId) throw new Error("Run unavailable");
    await api.request(`/api/projects/${project.id}/runs/${runId}/steer`, {
      method: "POST",
      body: JSON.stringify({ commandId: globalThis.crypto?.randomUUID?.() ?? `steer-${Date.now()}`, instruction }),
    });
  }

  async function startRun(modelSetId: string) {
    const modelSet = project.modelConfiguration?.modelSets.find(({ id }) => id === modelSetId);
    if (!modelSet) throw new Error("Model set unavailable");
    const result = await api.request<{ run: { id: string } }>(`/api/projects/${project.id}/runs`, { method: "POST", body: JSON.stringify({ idempotencyKey: globalThis.crypto?.randomUUID?.() ?? `run-${Date.now()}`, configuration: { modelSetId: modelSet.id, version: modelSet.version, agents: modelSet.agents } }) });
    setRunId(result.run.id);
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("run", result.run.id);
    window.history.replaceState({}, "", nextUrl);
    setCommandFeedback(`运行已创建，配置快照 ${modelSet.name} v${modelSet.version}。`);
  }

  async function command(name: "pause" | "resume" | "abort") {
    if (!runId) throw new Error("Run unavailable");
    if (name === "abort" && !window.confirm("确认终止当前运行？未提交的生成内容可能丢失。")) return;
    const result = await api.request<{ waiting_for_durable_commit?: boolean }>(`/api/projects/${project.id}/runs/${runId}/${name}`, { method: "POST" });
    if (name === "abort") setAbortWaiting(Boolean(result.waiting_for_durable_commit));
    setCommandFeedback(name === "pause" ? "暂停请求已排队，将在安全边界生效。" : name === "resume" ? "继续请求已提交。" : "终止请求已提交。")
  }

  async function answer(questionId: string, answers: Record<string, string>) {
    if (!runId) throw new Error("Run unavailable");
    await api.request(`/api/projects/${project.id}/runs/${runId}/answer`, { method: "POST", body: JSON.stringify({ questionId, answers }) });
    setPendingQuestion(null);
  }

  async function switchModel(role: string, provider: string, model: string, credentialId?: string, parameters?: Record<string, unknown>) {
    if (!runId) throw new Error("Run unavailable");
    const selection = { role, provider, model, credentialId, parameters };
    const result = await api.request<{ command: { commandId: string } }>(`/api/projects/${project.id}/runs/${runId}/model`, { method: "POST", body: JSON.stringify(selection) });
    setPendingCommandId(result.command.commandId);
    sessionStorage.setItem(commandStorageKey(project.id, runId), result.command.commandId);
    setLastModelSwitch(selection);
    setCommandFeedback("模型切换已排队，将在下一个 Agent 安全边界生效。");
  }

  async function diagnose() {
    if (!runId) throw new Error("Run unavailable");
    const result = await api.request<{ diagnostics: { summary: string; cursor: number; checkpointVersion: number | null } }>(`/api/projects/${project.id}/runs/${runId}/diagnostics`);
    setDiagnostics(`${result.diagnostics.summary} · cursor ${result.diagnostics.cursor} · checkpoint ${result.diagnostics.checkpointVersion ?? "none"}`);
  }

  return <div className="workbench-shell">
    <a className="skip-link" href="#main-content">跳到创作流</a>
    <header className="workbench-topbar"><a href="/projects" className="wordmark">SynChronicle</a><p>{project.title}</p><span>{project.latestRun?.status === "running" ? "创作进行中" : "创作台"}</span></header>
    <div className="panel-width-controls" aria-label="桌面栏宽调整">
      <label>调整作品栏宽度<input type="range" min="220" max="420" value={leftWidth} onChange={(event) => setLeftWidth(event.currentTarget.valueAsNumber)} /></label>
      <label>调整状态栏宽度<input type="range" min="240" max="420" value={rightWidth} onChange={(event) => setRightWidth(event.currentTarget.valueAsNumber)} /></label>
    </div>
    <div className={`workbench-grid left-${leftCollapsed ? "closed" : "open"} right-${rightCollapsed ? "closed" : "open"}`} style={{ "--left-open-width": `${leftWidth}px`, "--right-open-width": `${rightWidth}px` } as CSSProperties}>
      <div data-panel="project" data-mobile-active={panel === "project"}><ProjectNav title={project.title} chapters={project.chapters ?? []} selectedChapterId={selectedChapter?.id} collapsed={leftCollapsed} onToggle={() => setLeftCollapsed((value) => !value)} onSelect={selectChapter} /></div>
      <div className="writing-column" data-panel="writing" data-mobile-active={panel === "writing"}><ActivityFeed state={state} chapter={selectedChapter} /><PromptInput onSend={steer} /></div>
      <div data-panel="status" data-mobile-active={panel === "status"}><RunSidebar state={state} connection={connectionOverride ?? connection} status={project.latestRun?.status} agents={state.agents.length ? state.agents : project.agents ?? []} usage={state.usage ?? project.usage} pendingQuestion={pendingQuestion} modelConfiguration={project.modelConfiguration} commandFeedback={commandFeedback} commandRetry={commandFeedback?.startsWith("模型切换失败") && lastModelSwitch ? () => switchModel(lastModelSwitch.role, lastModelSwitch.provider, lastModelSwitch.model, lastModelSwitch.credentialId, lastModelSwitch.parameters) : undefined} diagnostics={diagnostics} abortWaiting={abortWaiting} controlsDisabled={!runId} collapsed={rightCollapsed} onToggle={() => setRightCollapsed((value) => !value)} onStart={startRun} onCommand={command} onAnswer={answer} onSwitchModel={switchModel} onDiagnose={diagnose} /></div>
    </div>
    <MobileNav current={panel} onChange={selectPanel} />
  </div>;
}
