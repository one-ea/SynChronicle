import { describe, expect, it, vi } from "vitest";
import { run } from "./run.js";

describe("headless run", () => {
  it("streams content to stdout and progress to stderr", async () => {
    const calls: string[] = [];
    const host = {
      store: { dir: "/book" },
      events: () => iterable([{ type: "system", time: "2026-01-01T12:34:56Z", message: "启动" }]),
      stream: () => iterable(["正文", "继续"]),
      startPrepared: vi.fn(async () => {}), resume: vi.fn(), replayQueue: vi.fn(async () => []), close: vi.fn(async () => {}),
    };
    await run({} as never, {} as never, {
      prompt: " 写一本书 ", hostFactory: async () => host as never,
      stdout: { write: (text: string) => { calls.push(`out:${text}`); return true; } } as never,
      stderr: { write: (text: string) => { calls.push(`err:${text}`); return true; } } as never,
    });
    expect(host.startPrepared).toHaveBeenCalledWith("写一本书");
    expect(calls.filter((call) => call.startsWith("out:")).map((call) => call.slice(4)).join("")).toBe("正文继续\n");
    expect(calls.join("|")).toContain("err:headless 启动: /book");
    expect(calls.join("|")).toContain("[12:34:56] [SYSTEM] 启动");
    expect(host.close).toHaveBeenCalled();
  });
});

async function* iterable<T>(items: T[]): AsyncIterable<T> { for (const item of items) yield item; }
