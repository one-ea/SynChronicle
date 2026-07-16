import { describe, expect, it, vi } from "vitest";
import { migrateFileProject, run } from "./run.js";

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

  it("prints reflection round and score as one progress line", async () => {
    const errors: string[] = [];
    const host = {
      store: { dir: "/book" },
      events: () => iterable([{ type: "reflection", time: "2026-01-01T12:34:56Z", agent: "writer", message: "review.completed", payload: { phase: "review_completed", round: 2, score: 90, passed: true } }]),
      stream: () => iterable([]),
      startPrepared: vi.fn(async () => {}), resume: vi.fn(), replayQueue: vi.fn(async () => []), close: vi.fn(async () => {}),
    };

    await run({} as never, {} as never, {
      prompt: "write", hostFactory: async () => host as never,
      stdout: { write: () => true } as never,
      stderr: { write: (text: string) => { errors.push(text); return true; } } as never,
    });

    expect(errors).toContain("[12:34:56] [REFLECTION] Writer · 第 2 轮评审 · 90 分 · 通过\n");
  });

  it("formats persisted reflection progress during recovery replay", async () => {
    const errors: string[] = [];
    const host = {
      store: { dir: "/book" }, events: () => iterable([]), stream: () => iterable([]), startPrepared: vi.fn(), close: vi.fn(async () => {}),
      replayQueue: vi.fn(async () => [{ seq: 1, time: "2026-01-01T12:34:56Z", kind: "ui_event", priority: "background", category: "REFLECTION", summary: "review.completed", payload: { type: "reflection", agent: "writer", message: "review.completed", payload: { phase: "review_completed", round: 2, score: 90, passed: true } } }]),
      resume: vi.fn(async () => ({ label: "checkpoint #1" })),
    };

    await run({} as never, {} as never, {
      hostFactory: async () => host as never,
      stdout: { write: () => true } as never,
      stderr: { write: (text: string) => { errors.push(text); return true; } } as never,
    });

    expect(errors).toContain("[12:34:56] [REFLECTION] Writer · 第 2 轮评审 · 90 分 · 通过\n");
  });

  it("falls back to the queue summary for an invalid persisted reflection payload", async () => {
    const errors: string[] = [];
    const host = {
      store: { dir: "/book" }, events: () => iterable([]), stream: () => iterable([]), startPrepared: vi.fn(), close: vi.fn(async () => {}),
      replayQueue: vi.fn(async () => [{ seq: 1, time: "2026-01-01T12:34:56Z", kind: "ui_event", priority: "background", category: "REFLECTION", summary: "review.completed", payload: { type: "reflection", message: "review.completed", payload: { phase: "review_completed", round: "bad" } } }]),
      resume: vi.fn(async () => ({ label: "checkpoint #1" })),
    };
    await run({} as never, {} as never, {
      hostFactory: async () => host as never,
      stdout: { write: () => true } as never,
      stderr: { write: (text: string) => { errors.push(text); return true; } } as never,
    });
    expect(errors).toContain("[12:34:56] [REFLECTION] review.completed\n");
    expect(errors.join("")).not.toContain("undefined");
  });
});

describe("file project CLI migration", () => {
  it("closes the database after successful migration", async () => {
    const end = vi.fn(async () => undefined);
    const database = { $client: { end }, select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: "user-1" }] }) }) }) };
    const importer = vi.fn(async () => ({ projectId: "project-1" }));
    await migrateFileProject({ databaseUrl: "postgres://db", username: "alice", projectDir: "/book" }, { createDatabase: () => database as never, importFileProject: importer as never, write: vi.fn() });
    expect(importer).toHaveBeenCalledWith(database, "user-1", "/book");
    expect(end).toHaveBeenCalledOnce();
  });

  it("closes the database when lookup or import fails", async () => {
    const end = vi.fn(async () => undefined);
    const database = { $client: { end }, select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: "user-1" }] }) }) }) };
    await expect(migrateFileProject({ databaseUrl: "postgres://db", username: "alice", projectDir: "/book" }, { createDatabase: () => database as never, importFileProject: vi.fn(async () => { throw new Error("import failed"); }) as never, write: vi.fn() })).rejects.toThrow("import failed");
    expect(end).toHaveBeenCalledOnce();
  });
});

async function* iterable<T>(items: T[]): AsyncIterable<T> { for (const item of items) yield item; }
