// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRef } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ApiClient } from "../api/client.js";
import { ApiError } from "../api/client.js";
import { WorkbenchPage, type WorkbenchProject } from "../pages/workbench.js";
import { initialRunViewState, reduceRunEvent, type RunEventMessage } from "../realtime/useRunEvents.js";
import { RunSidebar } from "./runSidebar.js";
import { resolveWorkbenchLayout } from "./useWorkbenchLayout.js";
import { WorkbenchDrawer } from "./workbenchDrawer.js";

const project: WorkbenchProject = {
  id: "project-1",
  title: "雾港来信",
  chapters: [
    { id: "chapter-1", title: "潮声抵达前", sequence: 1, status: "draft", body: "她在退潮后的码头读完了第一封信。" },
    { id: "chapter-2", title: "没有寄件人的灯塔", sequence: 2, status: "planned", body: "" },
  ],
  latestRun: { id: "11111111-1111-4111-8111-111111111111", status: "running" },
  agents: [{ name: "Writer", state: "stream.delta", summary: "正在续写", sequence: 9 }],
  usage: { inputTokens: 100, outputTokens: 60, totalTokens: 160, cost: "0.01200000", byAgent: [{ agent: "Writer", inputTokens: 100, outputTokens: 60, totalTokens: 160, cost: "0.01200000" }] },
  pendingQuestion: { id: "event-8", questions: [{ header: "篇幅", question: "希望多长？", options: ["短篇", "长篇"] }] },
  modelConfiguration: {
    activeModelSetId: "set-1",
    modelSets: [{ id: "set-1", name: "主力模型", version: 2, agents: { writer: { provider: "openai", model: "gpt-5", credentialId: "credential-1", parameters: { temperature: 0.4 } } } }],
    providers: [{ provider: "openai", models: ["gpt-5"], credentials: [{ id: "credential-1", label: "OpenAI personal" }] }],
  },
};

function api(): ApiClient {
  const request = vi.fn(async (path: string) => path.endsWith("/diagnostics") ? { diagnostics: { summary: "run healthy", cursor: 12, checkpointVersion: 7 } } : path.endsWith("/model") ? { run: project.latestRun, command: { commandId: "model:test" } } : { run: project.latestRun });
  return { request: request as ApiClient["request"] };
}

describe("run event projection", () => {
  it("deduplicates incremental events, merges stream chunks, and bounds rendered history", () => {
    let state = initialRunViewState;
    for (let sequence = 1; sequence <= 205; sequence += 1) {
      state = reduceRunEvent(state, {
        sequence,
        type: sequence === 1 ? "stream.delta" : "system",
        payload: sequence === 1 ? { taskId: "task-1", agent: "Writer", chunkSequence: 1, text: "潮声" } : { sequence },
        message: `事件 ${sequence}`,
      });
    }
    const duplicate = reduceRunEvent(state, { sequence: 205, type: "stream.delta", payload: { text: "重复" } });

    expect(state.stream).toBe("潮声");
    expect(state.events).toHaveLength(200);
    expect(state.events[0]?.sequence).toBe(6);
    expect(duplicate).toBe(state);
  });

  it("projects reflection progress", () => {
    const state = reduceRunEvent(initialRunViewState, {
      sequence: 1,
      type: "reflection",
      payload: { type: "reflection", agent: "Reviewer", payload: { phase: "review_completed", round: 2, maxRounds: 3, score: 88, passed: true } },
    });

    expect(state.reflection).toEqual({ round: 2, maxRounds: 3, score: 88, passed: true });
  });

  it("keeps compatibility with legacy stream payloads", () => {
    const legacy = reduceRunEvent(initialRunViewState, { sequence: 1, type: "stream_delta", payload: { delta: "旧协议" } });
    expect(legacy.stream).toBe("旧协议");
  });

  it("projects live Agent and usage events", () => {
    const agent = reduceRunEvent(initialRunViewState, { sequence: 1, type: "stream.delta", payload: { agent: "Writer", text: "x" } });
    const usage = reduceRunEvent(agent, { sequence: 2, type: "usage.snapshot", payload: { inputTokens: 12, outputTokens: 8, totalTokens: 20, cost: "0.01000000", byAgent: [] } });
    expect(usage.agents).toEqual([{ name: "Writer", state: "stream.delta", sequence: 1 }]);
    expect(usage.usage).toMatchObject({ totalTokens: 20, cost: "0.01000000" });
  });
  it("projects command applied and failed events by command ID", () => {
    const applied = reduceRunEvent(initialRunViewState, { sequence: 1, type: "command.applied", payload: { commandId: "model:1" } });
    const failed = reduceRunEvent(applied, { sequence: 2, type: "command.error", payload: { commandId: "model:2", category: "invalid_config", retryable: false, message: "Model unavailable" } });
    expect(failed.commands).toEqual(expect.objectContaining({ "model:1": { status: "applied" }, "model:2": expect.objectContaining({ status: "failed", message: "Model unavailable" }) }));
  });
});

describe("WorkbenchPage", () => {
  beforeEach(() => {
    sessionStorage.clear();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1200 });
  });

  it("resolves the three workbench layout ranges", () => {
    expect(resolveWorkbenchLayout(375)).toBe("mobile");
    expect(resolveWorkbenchLayout(767)).toBe("mobile");
    expect(resolveWorkbenchLayout(768)).toBe("tablet");
    expect(resolveWorkbenchLayout(1199)).toBe("tablet");
    expect(resolveWorkbenchLayout(1200)).toBe("desktop");
    expect(resolveWorkbenchLayout(1920)).toBe("desktop");
  });

  it("removes arbitrary panel width controls from the workbench", () => {
    render(<WorkbenchPage api={api()} project={project} initialEvents={[]} />);
    expect(screen.queryByRole("button", { name: "布局" })).not.toBeInTheDocument();
    expect(document.querySelector(".workbench-shell")).toHaveAttribute("data-layout-mode");
  });

  it("renders chapter text and reflection progress and sends a steering instruction", async () => {
    const client = api();
    const user = userEvent.setup();
    render(<WorkbenchPage api={client} project={project} initialEvents={[{
      sequence: 1,
      type: "reflection",
      agent: "Reviewer",
      payload: { phase: "review_completed", round: 2, maxRounds: 3, score: 88, passed: true },
    }]} />);

    expect(screen.getByText("Reviewer · 第 2/3 轮")).toBeVisible();
    expect(screen.getByText("88")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "查看章节《潮声抵达前》" }));
    expect(screen.getByText("她在退潮后的码头读完了第一封信。")).toBeVisible();
    await user.type(screen.getByLabelText("干预指令"), "加强结尾悬念");
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect(client.request).toHaveBeenCalledWith(
      "/api/projects/project-1/runs/11111111-1111-4111-8111-111111111111/steer",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("exposes three mobile destinations and preserves the selected panel in the URL", async () => {
    window.history.replaceState({}, "", "/projects/project-1?run=11111111-1111-4111-8111-111111111111&panel=writing");
    const user = userEvent.setup();
    render(<WorkbenchPage api={api()} project={project} initialEvents={[]} />);

    const navigation = screen.getByRole("navigation", { name: "创作台区域" });
    expect(navigation).toBeVisible();
    expect(within(navigation).getAllByRole("button")).toHaveLength(3);
    await user.click(screen.getByRole("button", { name: "运行" }));
    expect(new URL(window.location.href).searchParams.get("panel")).toBe("status");
    expect(screen.getByRole("button", { name: "运行" })).toHaveAttribute("aria-current", "page");
  });

  it("defaults mobile workbench to writing and exposes a compact run summary", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 375 });
    window.history.replaceState({}, "", "/projects/project-1");
    const user = userEvent.setup();
    render(<WorkbenchPage api={api()} project={project} initialEvents={[{
      sequence: 1,
      type: "reflection",
      payload: { round: 2, maxRounds: 3, score: 88, passed: false },
    }]} />);

    expect(screen.getByRole("button", { name: "创作" })).toHaveAttribute("aria-current", "page");
    const summary = screen.getByRole("button", { name: "查看运行状态：运行中，88 分" });
    expect(summary).toBeVisible();
    expect(summary).not.toHaveAttribute("role", "status");

    await user.click(summary);
    expect(screen.getByRole("button", { name: "运行" })).toHaveAttribute("aria-current", "page");
    expect(new URL(window.location.href).searchParams.get("panel")).toBe("status");
  });

  it("groups mobile run content without changing its interactive controls", () => {
    render(<WorkbenchPage api={api()} project={project} initialEvents={[{
      sequence: 1,
      type: "reflection",
      payload: { round: 2, maxRounds: 3, score: 88, passed: false },
    }]} />);

    expect(screen.getByRole("region", { name: "运行摘要详情" })).toContainElement(document.querySelector(".run-facts"));
    expect(screen.getByRole("region", { name: "反思进度" })).toHaveClass("run-progress-card");
    expect(document.querySelector(".run-agents-card .usage-card")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "运行操作" })).toContainElement(screen.getByRole("button", { name: "暂停运行" }));
    expect(screen.getByRole("region", { name: "运行配置" })).toContainElement(screen.getByRole("button", { name: "运行诊断" }));
  });

  it("announces reconnecting and backpressure states", () => {
    const { rerender } = render(<WorkbenchPage api={api()} project={project} initialEvents={[]} connectionOverride="reconnecting" />);
    expect(screen.getByRole("status")).toHaveTextContent("正在重新连接");

    rerender(<WorkbenchPage api={api()} project={project} initialEvents={[]} connectionOverride="backpressure" />);
    expect(screen.getByRole("alert")).toHaveTextContent("创作流过快");
  });

  it("uses the mobile workbench layout only below 768px without obsolete layout controls", () => {
    const css = readFileSync(resolve(process.cwd(), "src/web/client/styles/global.css"), "utf8");

    expect(css).toMatch(/@media \(max-width: 767px\) \{\n  \.workbench-topbar/);
    expect(css).not.toContain("@media (max-width: 768px)");
    expect(css).toContain(".workbench-grid { display: block;");
    expect(css).toContain(".mobile-workbench-nav");
    expect(css).not.toContain(".layout-controls");
    expect(css).not.toContain(".layout-control-row");
  });

  it("defines the complete tablet workbench geometry contract", () => {
    const css = readFileSync(resolve(process.cwd(), "src/web/client/styles/global.css"), "utf8");

    expect(css).toContain("@media (min-width: 768px) and (max-width: 1199px)");
    expect(css).toMatch(/\.workbench-tablet-toolbar\s*\{[^}]*height:\s*52px/);
    expect(css).toMatch(/\.workbench-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)[^}]*height:\s*calc\(100dvh - 58px - 52px\)/);
    expect(css).toMatch(/\.workbench-grid > \.writing-column\s*\{[^}]*grid-column:\s*1 \/ -1[^}]*height:\s*100%/);
    expect(css).toMatch(/\.workbench-drawer-layer\s*\{[^}]*position:\s*fixed[^}]*top:\s*110px[^}]*bottom:\s*0/);
    expect(css).toMatch(/\.workbench-drawer-backdrop\s*\{(?=[^}]*position:\s*absolute)(?=[^}]*inset:\s*0)/);
    expect(css).toMatch(/\.workbench-drawer\s*\{(?=[^}]*position:\s*absolute)(?=[^}]*overflow-y:\s*auto)/);
    expect(css).toMatch(/\.workbench-drawer-left\s*\{[^}]*left:\s*0/);
    expect(css).toMatch(/\.workbench-drawer-right\s*\{[^}]*right:\s*0/);
  });

  it("updates the shell layout mode on resize and clears the tablet drawer after leaving tablet", async () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 375 });
    const user = userEvent.setup();
    render(<WorkbenchPage api={api()} project={project} initialEvents={[]} />);
    const shell = document.querySelector(".workbench-shell");

    expect(shell).toHaveAttribute("data-layout-mode", "mobile");

    Object.defineProperty(window, "innerWidth", { configurable: true, value: 768 });
    act(() => window.dispatchEvent(new Event("resize")));
    expect(shell).toHaveAttribute("data-layout-mode", "tablet");

    await user.click(screen.getByRole("button", { name: "运行" }));
    expect(shell).toHaveAttribute("data-tablet-drawer", "status");

    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1200 });
    act(() => window.dispatchEvent(new Event("resize")));
    expect(shell).toHaveAttribute("data-layout-mode", "desktop");
    expect(shell).not.toHaveAttribute("data-tablet-drawer");
    Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
  });

  it("opens mutually exclusive tablet drawers and restores trigger focus", async () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
    fireEvent(window, new Event("resize"));
    const user = userEvent.setup();
    render(<WorkbenchPage api={api()} project={project} initialEvents={[]} />);

    const projectTrigger = screen.getByRole("button", { name: "打开章节目录" });
    const statusTrigger = screen.getByRole("button", { name: "打开运行状态" });
    expect(screen.queryByLabelText("作品结构")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("运行状态")).not.toBeInTheDocument();

    await user.click(projectTrigger);
    expect(screen.getByRole("dialog", { name: "章节目录" })).toBeVisible();
    expect(document.querySelectorAll(".project-nav")).toHaveLength(1);

    await user.click(statusTrigger);
    expect(screen.queryByRole("dialog", { name: "章节目录" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "运行状态" })).toBeVisible();
    expect(document.querySelectorAll(".run-sidebar")).toHaveLength(1);
    const ids = [...document.querySelectorAll<HTMLElement>("[id]")].map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "运行状态" })).not.toBeInTheDocument();
    expect(statusTrigger).toHaveFocus();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
  });

  it("traps focus inside tablet drawers and restores focus from every close control", async () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
    const user = userEvent.setup();
    render(<WorkbenchPage api={api()} project={project} initialEvents={[]} />);

    const projectTrigger = screen.getByRole("button", { name: "打开章节目录" });
    await user.click(projectTrigger);
    const dialog = screen.getByRole("dialog", { name: "章节目录" });
    const close = within(dialog).getByRole("button", { name: "关闭" });
    const last = within(dialog).getByRole("button", { name: "查看章节《没有寄件人的灯塔》" });
    expect(close).toHaveFocus();

    last.focus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(last).toHaveFocus();

    await user.click(last);
    expect(last).toHaveFocus();

    await user.click(close);
    expect(projectTrigger).toHaveFocus();
    await user.click(projectTrigger);
    await user.click(screen.getByRole("button", { name: "关闭章节目录" }));
    expect(projectTrigger).toHaveFocus();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
  });

  it("keeps run drawer Tab navigation inside enabled visible controls", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
    const user = userEvent.setup();
    render(<WorkbenchPage api={api()} project={{ ...project, latestRun: null }} initialEvents={[]} />);

    await user.click(screen.getByRole("button", { name: "打开运行状态" }));
    const dialog = screen.getByRole("dialog", { name: "运行状态" });
    const close = within(dialog).getByRole("button", { name: "关闭" });
    const credential = within(dialog).getByRole("combobox", { name: "凭证" });
    expect(within(dialog).getByRole("button", { name: "运行诊断" })).toBeDisabled();

    close.focus();
    await user.tab({ shift: true });
    expect(credential).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
  });

  it("excludes aria-hidden and visually hidden controls from the drawer focus loop", async () => {
    const triggerRef = createRef<HTMLButtonElement>();
    const user = userEvent.setup();
    render(<><button ref={triggerRef}>打开</button><WorkbenchDrawer side="left" label="测试抽屉" open triggerRef={triggerRef} onClose={vi.fn()}>
      <button type="button">有效控件</button>
      <button type="button" aria-hidden="true">隐藏控件</button>
      <button type="button" style={{ display: "none" }}>不可见控件</button>
      <span style={{ display: "none" }}><button type="button">祖先隐藏控件</button></span>
      <button type="button" disabled>禁用控件</button>
    </WorkbenchDrawer></>);

    const dialog = screen.getByRole("dialog", { name: "测试抽屉" });
    const close = within(dialog).getByRole("button", { name: "关闭" });
    const valid = within(dialog).getByRole("button", { name: "有效控件" });
    close.focus();
    await user.tab({ shift: true });
    expect(valid).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
  });

  it("requires an explicit model-set selection before creating a run", async () => {
    const request = vi.fn().mockResolvedValue({ run: { id: "22222222-2222-4222-8222-222222222222" } });
    const user = userEvent.setup();
    render(<WorkbenchPage api={{ request: request as ApiClient["request"] }} project={{ ...project, latestRun: null }} initialEvents={[]} />);

    const modelSet = screen.getByLabelText("模型集");
    const start = screen.getByRole("button", { name: "启动运行" });

    expect(modelSet).toHaveValue("");
    expect(modelSet).toHaveAccessibleDescription("选择本次运行使用的模型集。启动后仍可在安全边界切换模型。");
    expect(start).toBeDisabled();

    await user.selectOptions(modelSet, "set-1");
    expect(start).toBeEnabled();
    await user.click(start);

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      "/api/projects/project-1/runs",
      expect.objectContaining({ method: "POST", body: expect.stringContaining('"modelSetId":"set-1"') }),
    );
  });

  it("clears a selected model set when refreshed options remove it", async () => {
    const user = userEvent.setup();
    const sidebarProps = {
      state: initialRunViewState,
      connection: "idle" as const,
      agents: [],
      modelConfiguration: project.modelConfiguration,
      commandFeedback: null,
      diagnostics: null,
      abortWaiting: false,
      controlsDisabled: true,
      collapsed: false,
      onToggle: vi.fn(),
      onStart: vi.fn(),
      onCommand: vi.fn(),
      onAnswer: vi.fn(),
      onSwitchModel: vi.fn(),
      onDiagnose: vi.fn(),
    };
    const { rerender } = render(<RunSidebar {...sidebarProps} />);

    const modelSet = screen.getByLabelText("模型集");
    await user.selectOptions(modelSet, "set-1");
    expect(screen.getByRole("button", { name: "启动运行" })).toBeEnabled();

    rerender(<RunSidebar {...sidebarProps} modelConfiguration={{ ...project.modelConfiguration!, activeModelSetId: "set-2", modelSets: [{ id: "set-2", name: "备用模型", version: 1, agents: {} }] }} />);

    expect(modelSet).toHaveValue("");
    expect(screen.getByRole("button", { name: "启动运行" })).toBeDisabled();

    rerender(<RunSidebar {...sidebarProps} />);
    expect(modelSet).toHaveValue("");
    expect(screen.getByRole("button", { name: "启动运行" })).toBeDisabled();
  });

  it("announces pending run creation and prevents duplicate submission", async () => {
    let resolveRequest!: (value: { run: { id: string } }) => void;
    const request = vi.fn(() => new Promise<{ run: { id: string } }>((resolve) => { resolveRequest = resolve; }));
    const user = userEvent.setup();
    render(<WorkbenchPage api={{ request: request as ApiClient["request"] }} project={{ ...project, latestRun: null }} initialEvents={[]} />);

    await user.selectOptions(screen.getByLabelText("模型集"), "set-1");
    await user.click(screen.getByRole("button", { name: "启动运行" }));

    const pendingButton = screen.getByRole("button", { name: "正在启动" });
    expect(pendingButton).toBeDisabled();
    expect(pendingButton).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("正在启动运行。")).toHaveAttribute("aria-live", "polite");

    await user.click(pendingButton);
    expect(request).toHaveBeenCalledTimes(1);

    await act(async () => { resolveRequest({ run: { id: "22222222-2222-4222-8222-222222222222" } }); await Promise.resolve(); });
    await vi.waitFor(() => expect(screen.queryByRole("button", { name: "正在启动" })).not.toBeInTheDocument());
  });

  it("uses a not-allowed cursor for an unavailable create-run action", () => {
    const css = readFileSync(resolve(process.cwd(), "src/web/client/styles/global.css"), "utf8");
    expect(css).toContain('.run-create-card button:disabled:not([aria-busy="true"]) { cursor: not-allowed; }');
  });

  it("accepts incremental events without losing the current chapter", async () => {
    let push!: (event: RunEventMessage) => void;
    render(<WorkbenchPage api={api()} project={project} initialEvents={[]} subscribe={(listener) => { push = listener; return () => undefined; }} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "查看章节《潮声抵达前》" }));

    act(() => push({ sequence: 1, type: "stream.delta", payload: { taskId: "task-1", agent: "Writer", chunkSequence: 1, text: "新增段落" } }));

    expect(screen.getByText("新增段落")).toBeVisible();
    expect(screen.getByText("她在退潮后的码头读完了第一封信。")).toBeVisible();
  });

  it("deferred-refreshes the snapshot after lifecycle events", async () => {
    vi.useFakeTimers();
    try {
      let push!: (event: RunEventMessage) => void;
      const refreshed = { ...project, chapters: [...project.chapters!, { id: "chapter-3", title: "新章节", sequence: 3, status: "complete", body: "已提交正文" }], latestRun: { ...project.latestRun!, status: "completed", checkpointVersion: 8 } };
      const request = vi.fn().mockResolvedValue({ workbench: refreshed });
      render(<WorkbenchPage api={{ request: request as ApiClient["request"] }} project={project} initialEvents={[]} subscribe={(listener) => { push = listener; return () => undefined; }} />);

      act(() => push({ sequence: 1, type: "run.completed", payload: {} }));
      await act(async () => { await vi.advanceTimersByTimeAsync(150); await Promise.resolve(); });

      expect(request).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("button", { name: "查看章节《新章节》" })).toBeVisible();
      expect(within(screen.getByRole("region", { name: "运行摘要详情" })).getByText("completed")).toBeVisible();
    } finally { vi.useRealTimers(); }
  });

  it.each([
    { type: "system", payload: { category: "RUN.COMPLETED" } },
    { type: "ui_event", payload: { category: "WORKER.CONTROL", payload: { control: "paused" } } },
  ])("deferred-refreshes for legacy lifecycle event $type while continuously connected", async (event) => {
    vi.useFakeTimers();
    try {
      let push!: (event: RunEventMessage) => void;
      const request = vi.fn().mockResolvedValue({ workbench: project });
      render(<WorkbenchPage api={{ request: request as ApiClient["request"] }} project={project} initialEvents={[]} subscribe={(listener) => { push = listener; return () => undefined; }} />);
      act(() => push({ sequence: 1, ...event }));
      await act(async () => { await vi.advanceTimersByTimeAsync(150); });
      expect(request).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });

  it("renders and answers an AskUser question received from the live Worker stream", async () => {
    let push!: (event: RunEventMessage) => void;
    const client = api();
    const withoutQuestion = { ...project, pendingQuestion: null };
    render(<WorkbenchPage api={client} project={withoutQuestion} initialEvents={[]} subscribe={(listener) => { push = listener; return () => undefined; }} />);

    act(() => push({ sequence: 8, type: "tool", payload: { id: "ask:question-live", tool: "ask_user", payload: { questions: [{ header: "篇幅", question: "希望写多长？", options: [{ label: "长篇" }, { label: "短篇" }] }] } } }));

    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText("希望写多长？"), "长篇");
    await user.click(screen.getByRole("button", { name: "提交回答" }));
    expect(client.request).toHaveBeenCalledWith(expect.stringMatching(/\/answer$/), expect.objectContaining({ body: expect.stringContaining("question-live") }));
  });

  it("uses projected Agent/usage data and maps all workbench controls", async () => {
    const client = api();
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<WorkbenchPage api={client} project={project} initialEvents={[]} />);

    expect(screen.getByText("正在续写")).toBeVisible();
    expect(screen.getByText("160 tokens")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "暂停运行" }));
    await user.click(screen.getByRole("button", { name: "继续运行" }));
    await user.click(screen.getByRole("button", { name: "终止运行" }));
    await user.selectOptions(screen.getByLabelText("希望多长？"), "长篇");
    await user.click(screen.getByRole("button", { name: "提交回答" }));
    expect(screen.queryByRole("button", { name: "提交回答" })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Agent"), "writer");
    await user.selectOptions(screen.getByLabelText("Provider"), "openai");
    await user.selectOptions(screen.getByLabelText("模型"), "gpt-5");
    await user.click(screen.getByRole("button", { name: "切换模型" }));
    await user.click(screen.getByRole("button", { name: "运行诊断" }));

    expect(client.request).toHaveBeenCalledWith(expect.stringMatching(/\/pause$/), expect.objectContaining({ method: "POST" }));
    expect(client.request).toHaveBeenCalledWith(expect.stringMatching(/\/resume$/), expect.objectContaining({ method: "POST" }));
    expect(client.request).toHaveBeenCalledWith(expect.stringMatching(/\/abort$/), expect.objectContaining({ method: "POST" }));
    expect(client.request).toHaveBeenCalledWith(expect.stringMatching(/\/answer$/), expect.objectContaining({ method: "POST" }));
    expect(client.request).toHaveBeenCalledWith(expect.stringMatching(/\/model$/), expect.objectContaining({ method: "POST" }));
    expect(client.request).toHaveBeenCalledWith(expect.stringMatching(/\/diagnostics$/));
  });

  it("shows request IDs and retries failed controls without unhandled rejection", async () => {
    const request = vi.fn().mockRejectedValueOnce(new ApiError("request", "failed", 503, "req-control")).mockResolvedValue({ run: project.latestRun });
    const user = userEvent.setup();
    render(<WorkbenchPage api={{ request: request as ApiClient["request"] }} project={project} initialEvents={[]} />);
    await user.click(screen.getByRole("button", { name: "暂停运行" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("req-control");
    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("uses configured model choices and announces command state", async () => {
    const client = api();
    const user = userEvent.setup();
    render(<WorkbenchPage api={client} project={project} initialEvents={[]} />);
    await user.selectOptions(screen.getByLabelText("Agent"), "writer");
    await user.selectOptions(screen.getByLabelText("Provider"), "openai");
    await user.selectOptions(screen.getByLabelText("模型"), "gpt-5");
    await user.click(screen.getByRole("button", { name: "切换模型" }));
    expect(await screen.findByText(/安全边界/)).toBeVisible();
    expect(client.request).toHaveBeenCalledWith(expect.stringMatching(/\/model$/), expect.objectContaining({ body: expect.stringContaining("credential-1") }));
  });

  it("restores a run-scoped pending command and queries final status after reconnect", async () => {
    sessionStorage.setItem("synchronicle:command:project-1:11111111-1111-4111-8111-111111111111", "model:persisted");
    sessionStorage.setItem("synchronicle:command:project-1:other-run", "model:foreign");
    const request = vi.fn(async (path: string) => path.includes("/commands/model%3Apersisted") ? { command: { commandId: "model:persisted", status: "applied", retryable: false, failureCategory: null, errorMessage: null } } : { run: project.latestRun });
    render(<WorkbenchPage api={{ request: request as ApiClient["request"] }} project={project} initialEvents={[]} connectionOverride="connected" />);
    expect(await screen.findByText("模型切换已在安全边界应用。")).toBeVisible();
    expect(request).toHaveBeenCalledWith(expect.stringContaining("/commands/model%3Apersisted"));
    expect(request).not.toHaveBeenCalledWith(expect.stringContaining("model%3Aforeign"));
    expect(sessionStorage.getItem("synchronicle:command:project-1:11111111-1111-4111-8111-111111111111")).toBeNull();
  });

  it("refreshes a pending command immediately when the connection recovers", async () => {
    sessionStorage.setItem("synchronicle:command:project-1:11111111-1111-4111-8111-111111111111", "model:reconnect");
    const request = vi.fn().mockResolvedValue({ command: { commandId: "model:reconnect", status: "pending", retryable: false, failureCategory: null, errorMessage: null } });
    const client = { request: request as ApiClient["request"] };
    const { rerender } = render(<WorkbenchPage api={client} project={project} initialEvents={[]} connectionOverride="reconnecting" />);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));

    request.mockResolvedValueOnce({ command: { commandId: "model:reconnect", status: "applied", retryable: false, failureCategory: null, errorMessage: null } });
    rerender(<WorkbenchPage api={client} project={project} initialEvents={[]} connectionOverride="connected" />);

    expect(await screen.findByText("模型切换已在安全边界应用。")).toBeVisible();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("continues without command persistence when session storage is blocked", async () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("blocked", "SecurityError"); });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("blocked", "SecurityError"); });
    const removeItem = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new DOMException("blocked", "SecurityError"); });
    const client = api();
    const user = userEvent.setup();

    render(<WorkbenchPage api={client} project={project} initialEvents={[]} />);
    await user.selectOptions(screen.getByLabelText("Agent"), "writer");
    await user.selectOptions(screen.getByLabelText("Provider"), "openai");
    await user.selectOptions(screen.getByLabelText("模型"), "gpt-5");
    await user.click(screen.getByRole("button", { name: "切换模型" }));

    expect(await screen.findByText(/模型切换已排队/)).toBeVisible();
    expect(getItem).toHaveBeenCalled();
    expect(setItem).toHaveBeenCalled();
    removeItem.mockRestore();
    setItem.mockRestore();
    getItem.mockRestore();
  });

  it("restores panel, focus, chapter, and scroll on popstate", async () => {
    window.history.replaceState({}, "", "/projects/project-1?panel=writing&chapter=chapter-1");
    const user = userEvent.setup();
    render(<WorkbenchPage api={api()} project={project} initialEvents={[]} />);
    const writingScroll = document.querySelector<HTMLElement>("[data-panel='writing'] .activity-scroll")!;
    writingScroll.scrollTop = 137;
    await user.click(screen.getByRole("button", { name: "运行" }));
    await act(async () => {
      window.history.replaceState({}, "", "/projects/project-1?panel=writing&chapter=chapter-1");
      window.dispatchEvent(new PopStateEvent("popstate"));
      await Promise.resolve();
    });

    await vi.waitFor(() => expect(screen.getByRole("button", { name: "创作" })).toHaveAttribute("aria-current", "page"));
    expect(screen.getByText("她在退潮后的码头读完了第一封信。")).toBeVisible();
    expect(writingScroll.scrollTop).toBe(137);
    await vi.waitFor(() => expect(screen.getByRole("main")).toHaveFocus());
  });
});
