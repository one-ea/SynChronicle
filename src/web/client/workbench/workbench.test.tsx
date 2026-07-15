// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ApiClient } from "../api/client.js";
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
};

function api(): ApiClient {
  const request = vi.fn(async (path: string) => path.endsWith("/diagnostics") ? { diagnostics: { summary: "run healthy", cursor: 12, checkpointVersion: 7 } } : { run: project.latestRun });
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
});

describe("WorkbenchPage", () => {
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
    await user.type(screen.getByLabelText("角色"), "writer");
    await user.type(screen.getByLabelText("Provider"), "openai");
    await user.type(screen.getByLabelText("模型"), "gpt-5");
    await user.click(screen.getByRole("button", { name: "切换模型" }));
    await user.click(screen.getByRole("button", { name: "运行诊断" }));

    expect(client.request).toHaveBeenCalledWith(expect.stringMatching(/\/pause$/), expect.objectContaining({ method: "POST" }));
    expect(client.request).toHaveBeenCalledWith(expect.stringMatching(/\/resume$/), expect.objectContaining({ method: "POST" }));
    expect(client.request).toHaveBeenCalledWith(expect.stringMatching(/\/abort$/), expect.objectContaining({ method: "POST" }));
    expect(client.request).toHaveBeenCalledWith(expect.stringMatching(/\/answer$/), expect.objectContaining({ method: "POST" }));
    expect(client.request).toHaveBeenCalledWith(expect.stringMatching(/\/model$/), expect.objectContaining({ method: "POST" }));
    expect(client.request).toHaveBeenCalledWith(expect.stringMatching(/\/diagnostics$/));
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
