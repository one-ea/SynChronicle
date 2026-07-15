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
    { id: "chapter-1", title: "潮声抵达前", order: 1, status: "draft", body: "她在退潮后的码头读完了第一封信。" },
    { id: "chapter-2", title: "没有寄件人的灯塔", order: 2, status: "planned", body: "" },
  ],
  latestRun: { id: "11111111-1111-4111-8111-111111111111", status: "running" },
};

function api(): ApiClient {
  return { request: vi.fn().mockResolvedValue({ run: project.latestRun }) };
}

describe("run event projection", () => {
  it("deduplicates incremental events, merges stream chunks, and bounds rendered history", () => {
    let state = initialRunViewState;
    for (let sequence = 1; sequence <= 205; sequence += 1) {
      state = reduceRunEvent(state, {
        sequence,
        type: sequence === 1 ? "stream" : "system",
        payload: sequence === 1 ? { delta: "潮声" } : { sequence },
        message: `事件 ${sequence}`,
      });
    }
    const duplicate = reduceRunEvent(state, { sequence: 205, type: "stream", payload: { delta: "重复" } });

    expect(state.stream).toBe("潮声");
    expect(state.events).toHaveLength(200);
    expect(state.events[0]?.sequence).toBe(6);
    expect(duplicate).toBe(state);
  });

  it("projects reflection progress", () => {
    const state = reduceRunEvent(initialRunViewState, {
      sequence: 1,
      type: "reflection",
      agent: "Reviewer",
      payload: { phase: "review_completed", round: 2, maxRounds: 3, score: 88, passed: true },
    });

    expect(state.reflection).toEqual({ round: 2, maxRounds: 3, score: 88, passed: true });
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

    act(() => push({ sequence: 1, type: "stream", payload: { delta: "新增段落" } }));

    expect(screen.getByText("新增段落")).toBeVisible();
    expect(screen.getByText("她在退潮后的码头读完了第一封信。")).toBeVisible();
  });
});
