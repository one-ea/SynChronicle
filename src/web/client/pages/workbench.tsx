import { useEffect, useRef, useState } from "react";
import type { ApiClient } from "../api/client.js";
import { useRunEvents, type ConnectionState, type RunEventMessage } from "../realtime/useRunEvents.js";
import { ActivityFeed } from "../workbench/activityFeed.js";
import { MobileNav, type WorkbenchPanel } from "../workbench/mobileNav.js";
import { ProjectNav } from "../workbench/projectNav.js";
import { PromptInput } from "../workbench/promptInput.js";
import { RunSidebar } from "../workbench/runSidebar.js";
import { useWorkbenchLayout } from "../workbench/useWorkbenchLayout.js";
import { WorkbenchDrawer } from "../workbench/workbenchDrawer.js";

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
function safeSessionGet(key: string) { try { return sessionStorage.getItem(key); } catch { return null; } }
function safeSessionSet(key: string, value: string) { try { sessionStorage.setItem(key, value); } catch { /* Persistence is optional. */ } }
function safeSessionRemove(key: string) { try { sessionStorage.removeItem(key); } catch { /* Persistence is optional. */ } }
function liveQuestion(event: RunEventMessage | undefined): WorkbenchProject["pendingQuestion"] {
  if (!event || event.type !== "tool" || !event.payload || typeof event.payload !== "object") return null;
  const payload = event.payload as Record<string, unknown>;
  const argumentsPayload = payload.payload && typeof payload.payload === "object" ? payload.payload as Record<string, unknown> : payload;
  if (payload.tool !== "ask_user" || !Array.isArray(argumentsPayload.questions)) return null;
  const questions = argumentsPayload.questions.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const row = candidate as Record<string, unknown>;
    const options = Array.isArray(row.options) ? row.options.flatMap((option) => typeof option === "string" ? [option] : option && typeof option === "object" && typeof (option as Record<string, unknown>).label === "string" ? [String((option as Record<string, unknown>).label)] : []) : [];
    return typeof row.header === "string" && typeof row.question === "string" ? [{ header: row.header, question: row.question, options }] : [];
  });
  const id = typeof payload.id === "string" ? payload.id.replace(/^ask:/, "") : `event-${event.sequence}`;
  return questions.length ? { id, questions } : null;
}

export function shouldRefreshWorkbenchSnapshot(event: RunEventMessage): boolean {
  if (/^(run\.(started|paused|resumed|completed|cancelled|failed)|checkpoint\.committed)$/.test(event.type)) return true;
  if (event.type !== "system" && event.type !== "ui_event") return false;
  const payload = event.payload && typeof event.payload === "object" ? event.payload as Record<string, unknown> : {};
  const nested = payload.payload && typeof payload.payload === "object" ? payload.payload as Record<string, unknown> : {};
  const category = typeof payload.category === "string" ? payload.category : typeof nested.category === "string" ? nested.category : "";
  const control = typeof nested.control === "string" ? nested.control : typeof payload.control === "string" ? payload.control : "";
  return /^(RUN|LIFECYCLE)\.(STARTED|PAUSED|RESUMED|COMPLETED|CANCELLED|FAILED|CHECKPOINT_COMMITTED)$/i.test(category) || ["paused", "resumed", "cancelled", "completed", "failed"].includes(control);
}

export function WorkbenchPage({ api, project: initialProject, initialEvents, subscribe, connectionOverride }: WorkbenchPageProps) {
  const [project, setProject] = useState(initialProject);
  const url = new URL(window.location.href);
  const initialRunId = url.searchParams.get("run") ?? project.latestRun?.id ?? undefined;
  const [runId, setRunId] = useState(initialRunId);
  const chapterId = url.searchParams.get("chapter") ?? undefined;
  const [panel, setPanel] = useState<WorkbenchPanel>(initialPanel);
  const [selectedChapter, setSelectedChapter] = useState(() => project.chapters?.find(({ id }) => id === chapterId));
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const layoutMode = useWorkbenchLayout();
  const [tabletDrawer, setTabletDrawer] = useState<"project" | "status" | null>(null);
  const [diagnostics, setDiagnostics] = useState<string | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState(project.pendingQuestion);
  const [abortWaiting, setAbortWaiting] = useState(Boolean(project.latestRun?.waiting_for_durable_commit));
  const [commandFeedback, setCommandFeedback] = useState<string | null>(null);
  const [pendingCommandId, setPendingCommandId] = useState<string | null>(() => initialRunId ? safeSessionGet(commandStorageKey(project.id, initialRunId)) : null);
  const [lastModelSwitch, setLastModelSwitch] = useState<{ role: string; provider: string; model: string; credentialId?: string; parameters?: Record<string, unknown> } | null>(null);
  const scrollPositions = useRef<Record<WorkbenchPanel, number>>({ project: 0, writing: 0, status: 0 });
  const projectDrawerTrigger = useRef<HTMLButtonElement>(null);
  const statusDrawerTrigger = useRef<HTMLButtonElement>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const previousConnection = useRef<ConnectionState | undefined>(undefined);
  const { state, connection } = useRunEvents({ runId, initialEvents, subscribe });
  useEffect(() => {
    if (layoutMode !== "tablet") setTabletDrawer(null);
  }, [layoutMode]);
  const refreshSnapshot = () => {
    if (refreshTimer.current) return;
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = undefined;
      void api.request<{ workbench?: WorkbenchProject }>(`/api/projects/${project.id}/workbench`).then(({ workbench }) => { if (workbench) setProject(workbench); }).catch(() => undefined);
    }, 100);
  };
  useEffect(() => () => { if (refreshTimer.current) clearTimeout(refreshTimer.current); }, []);
  useEffect(() => {
    const effective = connectionOverride ?? connection;
    if (effective === "connected" && previousConnection.current && previousConnection.current !== "connected") refreshSnapshot();
    previousConnection.current = effective;
  }, [connection, connectionOverride]);
  useEffect(() => {
    const latest = state.events.at(-1);
    const payload = latest?.payload && typeof latest.payload === "object" ? latest.payload as Record<string, unknown> : {};
    const message = typeof payload.message === "string" ? payload.message : latest?.message ?? "";
    if (/完成|cancel|abort|终止/i.test(message)) setAbortWaiting(false);
    const question = liveQuestion(latest);
    if (question) setPendingQuestion(question);
    if (latest && shouldRefreshWorkbenchSnapshot(latest)) refreshSnapshot();
  }, [state.events]);
  useEffect(() => {
    if (!selectedChapter) return;
    setSelectedChapter(project.chapters?.find(({ id }) => id === selectedChapter.id));
  }, [project.chapters]);
  useEffect(() => {
    if (!pendingCommandId) return;
    const command = state.commands[pendingCommandId];
    if (!command) return;
    setCommandFeedback(command.status === "applied" ? "模型切换已在安全边界应用。" : `模型切换失败：${command.message ?? command.category ?? "未知错误"}`);
    if (runId) safeSessionRemove(commandStorageKey(project.id, runId));
    setPendingCommandId(null);
  }, [pendingCommandId, state.commands]);
  useEffect(() => {
    if (!runId) { setPendingCommandId(null); return; }
    setPendingCommandId(safeSessionGet(commandStorageKey(project.id, runId)));
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
          safeSessionRemove(commandStorageKey(project.id, runId));
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
    if (layoutMode === "tablet" && next !== "writing") setTabletDrawer(next);
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
    refreshSnapshot();
  }

  async function command(name: "pause" | "resume" | "abort") {
    if (!runId) throw new Error("Run unavailable");
    if (name === "abort" && !window.confirm("确认终止当前运行？未提交的生成内容可能丢失。")) return;
    const result = await api.request<{ waiting_for_durable_commit?: boolean }>(`/api/projects/${project.id}/runs/${runId}/${name}`, { method: "POST" });
    if (name === "abort") setAbortWaiting(Boolean(result.waiting_for_durable_commit));
    setCommandFeedback(name === "pause" ? "暂停请求已排队，将在安全边界生效。" : name === "resume" ? "继续请求已提交。" : "终止请求已提交。")
    refreshSnapshot();
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
    safeSessionSet(commandStorageKey(project.id, runId), result.command.commandId);
    setLastModelSwitch(selection);
    setCommandFeedback("模型切换已排队，将在下一个 Agent 安全边界生效。");
  }

  async function diagnose() {
    if (!runId) throw new Error("Run unavailable");
    const result = await api.request<{ diagnostics: { summary: string; cursor: number; checkpointVersion: number | null } }>(`/api/projects/${project.id}/runs/${runId}/diagnostics`);
    setDiagnostics(`${result.diagnostics.summary} · cursor ${result.diagnostics.cursor} · checkpoint ${result.diagnostics.checkpointVersion ?? "none"}`);
  }

  const embeddedPanels = layoutMode !== "desktop";
  const projectNav = <ProjectNav title={project.title} chapters={project.chapters ?? []} selectedChapterId={selectedChapter?.id} collapsed={embeddedPanels ? false : leftCollapsed} presentation={embeddedPanels ? "embedded" : "desktop"} onToggle={() => setLeftCollapsed((value) => !value)} onSelect={selectChapter} />;
  const runSidebar = <RunSidebar state={state} connection={connectionOverride ?? connection} status={project.latestRun?.status} agents={state.agents.length ? state.agents : project.agents ?? []} usage={state.usage ?? project.usage} pendingQuestion={pendingQuestion} modelConfiguration={project.modelConfiguration} commandFeedback={commandFeedback} commandRetry={commandFeedback?.startsWith("模型切换失败") && lastModelSwitch ? () => switchModel(lastModelSwitch.role, lastModelSwitch.provider, lastModelSwitch.model, lastModelSwitch.credentialId, lastModelSwitch.parameters) : undefined} diagnostics={diagnostics} abortWaiting={abortWaiting} controlsDisabled={!runId} collapsed={embeddedPanels ? false : rightCollapsed} presentation={embeddedPanels ? "embedded" : "desktop"} onToggle={() => setRightCollapsed((value) => !value)} onStart={startRun} onCommand={command} onAnswer={answer} onSwitchModel={switchModel} onDiagnose={diagnose} />;
  const writingColumn = <div className="writing-column" data-panel="writing" data-mobile-active={panel === "writing"}><ActivityFeed state={state} chapter={selectedChapter} /><PromptInput onSend={steer} /></div>;

  return <div className="workbench-shell" data-layout-mode={layoutMode} data-tablet-drawer={tabletDrawer ?? undefined}>
    <a className="skip-link" href="#main-content">跳到创作流</a>
    <header className="workbench-topbar"><a href="/projects" className="wordmark">SynChronicle</a><p>{project.title}</p><div className="workbench-topbar-actions"><span>{project.latestRun?.status === "running" ? "创作进行中" : "创作台"}</span></div></header>
    {layoutMode === "tablet" && <div className="workbench-tablet-toolbar">
      <button ref={projectDrawerTrigger} type="button" onClick={() => setTabletDrawer("project")}>打开章节目录</button>
      <strong>{selectedChapter?.title ?? project.title}</strong>
      <button ref={statusDrawerTrigger} type="button" onClick={() => setTabletDrawer("status")}>打开运行状态</button>
    </div>}
    <div className={`workbench-grid left-${leftCollapsed ? "closed" : "open"} right-${rightCollapsed ? "closed" : "open"}`}>
      {layoutMode === "desktop" && <div data-panel="project">{projectNav}</div>}
      {layoutMode === "mobile" && <div data-panel="project" data-mobile-active={panel === "project"}>{projectNav}</div>}
      {writingColumn}
      {layoutMode === "desktop" && <div data-panel="status">{runSidebar}</div>}
      {layoutMode === "mobile" && <div data-panel="status" data-mobile-active={panel === "status"}>{runSidebar}</div>}
    </div>
    <WorkbenchDrawer side="left" label="章节目录" open={layoutMode === "tablet" && tabletDrawer === "project"} triggerRef={projectDrawerTrigger} onClose={() => setTabletDrawer(null)}>{projectNav}</WorkbenchDrawer>
    <WorkbenchDrawer side="right" label="运行状态" open={layoutMode === "tablet" && tabletDrawer === "status"} triggerRef={statusDrawerTrigger} onClose={() => setTabletDrawer(null)}>{runSidebar}</WorkbenchDrawer>
    <MobileNav current={panel} onChange={selectPanel} />
  </div>;
}
