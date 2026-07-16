import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { TestProcessOrchestrator } from "./e2e-orchestrator.js";

describe("E2E process orchestrator", () => {
  it("kills the active Worker and restarts a distinct Worker identity", async () => {
    const children: Array<EventEmitter & { pid: number; kill: ReturnType<typeof vi.fn> }> = [];
    const spawn = vi.fn((_entry: string, env: NodeJS.ProcessEnv) => {
      const child = Object.assign(new EventEmitter(), { pid: 100 + children.length, kill: vi.fn(() => true), env });
      children.push(child);
      return child as never;
    });
    const orchestrator = new TestProcessOrchestrator({ spawn, env: { DATABASE_URL: "postgres://test" } });

    orchestrator.startWorker();
    expect(orchestrator.snapshot()).toMatchObject({ worker: { id: "e2e-worker-1", pid: 100, running: true } });
    const killed = orchestrator.killWorker();
    let settled = false;
    void killed.then(() => { settled = true; });
    expect(children[0]!.kill).toHaveBeenCalledWith("SIGKILL");
    await Promise.resolve();
    expect(settled).toBe(false);
    children[0]!.emit("exit", null, "SIGKILL");
    await killed;
    expect(settled).toBe(true);
    orchestrator.startWorker();

    expect(orchestrator.snapshot()).toMatchObject({ worker: { id: "e2e-worker-2", pid: 101, running: true } });
  });
});
