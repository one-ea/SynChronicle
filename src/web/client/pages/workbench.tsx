import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { ApiClient } from "../api/client.js";
import { useRunEvents, type ConnectionState, type RunEventMessage } from "../realtime/useRunEvents.js";
import { ActivityFeed } from "../workbench/activityFeed.js";
import { MobileNav, type WorkbenchPanel } from "../workbench/mobileNav.js";
import { ProjectNav } from "../workbench/projectNav.js";
import { PromptInput } from "../workbench/promptInput.js";
import { RunSidebar } from "../workbench/runSidebar.js";

export interface WorkbenchChapter { id: string; title: string; order: number; status: string; body: string }
export interface WorkbenchProject { id: string; title: string; chapters?: WorkbenchChapter[]; latestRun?: { id: string; status: string } | null }

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

export function WorkbenchPage({ api, project, initialEvents, subscribe, connectionOverride }: WorkbenchPageProps) {
  const url = new URL(window.location.href);
  const runId = url.searchParams.get("run") ?? project.latestRun?.id ?? undefined;
  const chapterId = url.searchParams.get("chapter") ?? undefined;
  const [panel, setPanel] = useState<WorkbenchPanel>(initialPanel);
  const [selectedChapter, setSelectedChapter] = useState(() => project.chapters?.find(({ id }) => id === chapterId));
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [leftWidth, setLeftWidth] = useState(280);
  const [rightWidth, setRightWidth] = useState(300);
  const scrollPositions = useRef<Record<WorkbenchPanel, number>>({ project: 0, writing: 0, status: 0 });
  const { state, connection } = useRunEvents({ runId, initialEvents, subscribe });

  useEffect(() => {
    const current = document.querySelector<HTMLElement>(`[data-panel='${panel}'] .activity-scroll, [data-panel='${panel}']`);
    if (current) current.scrollTop = scrollPositions.current[panel];
  }, [panel]);

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
      <div data-panel="status" data-mobile-active={panel === "status"}><RunSidebar state={state} connection={connectionOverride ?? connection} status={project.latestRun?.status} collapsed={rightCollapsed} onToggle={() => setRightCollapsed((value) => !value)} /></div>
    </div>
    <MobileNav current={panel} onChange={selectPanel} />
  </div>;
}
