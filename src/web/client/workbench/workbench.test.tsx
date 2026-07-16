// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ApiClient } from "../api/client.js";
import { ApiError } from "../api/client.js";
import { WorkbenchPage, type WorkbenchProject } from "../pages/workbench.js";
import { initialRunViewState, reduceRunEvent, type RunEventMessage } from "../realtime/useRunEvents.js";

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
  beforeEach(() => sessionStorage.clear());

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
    await user.click(screen.getByRole("button", { name: "状态" }));
    expect(new URL(window.location.href).searchParams.get("panel")).toBe("status");
    expect(screen.getByRole("button", { name: "状态" })).toHaveAttribute("aria-current", "page");
  });

  it("announces reconnecting and backpressure states", () => {
    const { rerender } = render(<WorkbenchPage api={api()} project={project} initialEvents={[]} connectionOverride="reconnecting" />);
    expect(screen.getByRole("status")).toHaveTextContent("正在重新连接");

    rerender(<WorkbenchPage api={api()} project={project} initialEvents={[]} connectionOverride="backpressure" />);
    expect(screen.getByRole("alert")).toHaveTextContent("创作流过快");
  });

  it("offers keyboard-operable desktop panel width controls", () => {
    render(<WorkbenchPage api={api()} project={project} initialEvents={[]} />);
    const leftWidth = screen.getByLabelText("调整作品栏宽度");
    const rightWidth = screen.getByLabelText("调整状态栏宽度");

    expect(leftWidth).toHaveAttribute("type", "range");
    expect(rightWidth).toHaveAttribute("type", "range");
    fireEvent.change(leftWidth, { target: { value: "281" } });
    expect(leftWidth).toHaveValue("281");
  });

  it("accepts incremental events without losing the current chapter", async () => {
    let push!: (event: RunEventMessage) => void;
    render(<WorkbenchPage api={api()} project={project} initialEvents={[]} subscribe={(listener) => { push = listener; return () => undefined; }} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "查看章节《潮声抵达前》" }));

    act(() => push({ sequence: 1, type: "stream.delta", payload: { taskId: "task-1", agent: "Writer", chunkSequence: 1, text: "新增段落" } }));

    expect(screen.getByText("新增段落")).toBeVisible();
    expect(screen.getByText("她在退潮后的码头读完了第一封信。")).toBeVisible();
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
    await user.click(screen.getByRole("button", { name: "状态" }));
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
