import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import { App } from "./app.js";
import { parseCommand } from "./commands.js";
import { AskUser } from "./ask_user.js";
import type { TuiHost } from "./events.js";

async function* sequence<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) yield item;
}

function host(overrides: Partial<TuiHost> = {}): TuiHost {
  return {
    events: () => sequence([]),
    stream: () => sequence([]),
    snapshot: () => ({ runtimeState: "idle", recoveryLabel: null, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUSD: 0 }, provider: "openrouter", model: "test-model" }),
    startPrepared: vi.fn(async () => undefined),
    continue: vi.fn(async () => undefined),
    abort: vi.fn(),
    export: vi.fn(async () => ({ path: "/tmp/book.txt", chapters: 2 })),
    importText: vi.fn(async () => ({ chapters: 2 })),
    ...overrides,
  };
}

describe("TUI", () => {
  it("renders startup choices and starts a quick session", async () => {
    const runtime = host();
    const view = render(<App host={runtime} version="v2.0.0" />);
    expect(view.lastFrame()).toContain("快速开始");
    view.stdin.write("写一部悬疑小说");
    view.stdin.write("\r");
    await vi.waitFor(() => expect(runtime.startPrepared).toHaveBeenCalledWith("写一部悬疑小说"));
    await vi.waitFor(() => expect(view.lastFrame()).toContain("创作工作台"));
  });

  it("renders host events, stream output, statistics and checkpoint state", async () => {
    const runtime = host({
      events: () => sequence([
        { type: "dispatch", time: "2026-07-12T10:00:00Z", agent: "writer", message: "撰写第 2 章" },
        { type: "tool", time: "2026-07-12T10:00:01Z", agent: "writer", message: "draft_chapter 1/2", payload: { progress: "1/2" } },
        { type: "system", time: "2026-07-12T10:00:02Z", message: "checkpoint #12 已保存", payload: { checkpoint: 12 } },
      ]),
      stream: () => sequence(["风从", "旧城吹来。"]),
      snapshot: () => ({ runtimeState: "running", recoveryLabel: "从 checkpoint #11 恢复", usage: { inputTokens: 120, outputTokens: 80, totalTokens: 200, costUSD: 0.02 }, provider: "openrouter", model: "test-model", phase: "writing", completedCount: 1, totalChapters: 12 }),
    });
    const view = render(<App host={runtime} initialPage="workbench" />);
    await vi.waitFor(() => expect(view.lastFrame()).toContain("旧城吹来"));
    const frame = view.lastFrame() ?? "";
    expect(frame).toContain("Writer");
    expect(frame).toContain("draft_chapter 1/2");
    expect(frame).toContain("checkpoint #12");
    expect(frame).toContain("200 tokens");
    expect(frame).toContain("从 checkpoint #11 恢复");
  });

  it("parses model, diag, export and import commands", () => {
    expect(parseCommand("/model writer openrouter gpt-4.1")).toMatchObject({ name: "model", args: ["writer", "openrouter", "gpt-4.1"] });
    expect(parseCommand("/diag")).toMatchObject({ name: "diag" });
    expect(parseCommand("/export epub book.epub from=2 to=4")).toMatchObject({ name: "export" });
    expect(parseCommand("/import ./book.txt")).toMatchObject({ name: "import" });
  });

  it("collects an AskUser option through Ink input", async () => {
    const answer = vi.fn();
    const view = render(<AskUser questions={[{ question: "选择叙事视角", options: [{ label: "第一人称", description: "主角视角" }, { label: "第三人称", description: "全知视角" }] }]} onSubmit={answer} />);
    expect(view.lastFrame()).toContain("第一人称");
    view.stdin.write("\u001B[B");
    view.stdin.write("\r");
    await vi.waitFor(() => expect(answer).toHaveBeenCalledWith({ "选择叙事视角": "第三人称" }));
  });
});
