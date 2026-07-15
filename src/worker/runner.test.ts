import { describe, expect, it, vi } from "vitest";
import { Host, type RuntimeAgent } from "../runtime/host.js";
import type { RunResumeData } from "../scheduler/types.js";
import { createMemoryDatabaseStore } from "../store/database/index.js";
import { WorkerRunner, taskFingerprint, type ClaimedTask, type WorkerHost, type WorkerScheduler } from "./runner.js";

function task(overrides: Partial<ClaimedTask> = {}): ClaimedTask {
  const now = new Date();
  return {
    id: "task-1",
    userId: "user-1",
    projectId: "project-1",
    runId: "run-1",
    type: "write",
    status: "leased",
    priority: 0,
    leaseOwner: "worker-1",
    leaseExpiresAt: new Date(now.getTime() + 30_000),
    leaseVersion: 1,
    attempts: 1,
    maxAttempts: 3,
    scheduledAt: now,
    payload: { prompt: "Write chapter one" },
    createdAt: now,
    updatedAt: now,
    projectVersion: 1,
    ...overrides,
  };
}

function scheduler(claimed: ClaimedTask | null, control: RunResumeData = { desiredState: "running", steerCommands: [] }) {
  const value: WorkerScheduler = {
    claimNextTask: vi.fn().mockResolvedValue(claimed),
    startTask: vi.fn().mockResolvedValue(true),
    renewLease: vi.fn().mockResolvedValue(true),
    readRunControl: vi.fn().mockResolvedValue(control),
    claimSteerCommands: vi.fn().mockResolvedValueOnce(control.steerCommands).mockResolvedValue([]),
    acknowledgeSteerCommands: vi.fn().mockResolvedValue(true),
    finishTask: vi.fn().mockResolvedValue(true),
    recordTaskError: vi.fn().mockResolvedValue(true),
    recordTaskControl: vi.fn().mockResolvedValue(true),
  };
  return value;
}

function host(options: { checkpoint?: { taskFingerprint: string; projectVersion: number } | null; execute?: (signal?: AbortSignal) => Promise<void>; onBoundary?: (boundary: () => Promise<void>) => void } = {}) {
  let boundary: (() => Promise<void>) | undefined;
  const value: WorkerHost = {
    latestCheckpoint: vi.fn().mockResolvedValue(options.checkpoint ?? null),
    startPrepared: vi.fn(async (_prompt: string, signal?: AbortSignal) => options.execute?.(signal)),
    resume: vi.fn(async () => { await options.execute?.(); return { label: "chapter 1" }; }),
    steer: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    setBoundaryHandler: vi.fn((handler) => { boundary = handler; options.onBoundary?.(handler); }),
  };
  return { value, boundary: () => boundary };
}

describe("WorkerRunner", () => {
  it("recovers an expired task from the latest matching checkpoint", async () => {
    const claimed = task({ attempts: 2 });
    const repository = scheduler(claimed);
    const fakeHost = host({ checkpoint: { taskFingerprint: taskFingerprint(claimed), projectVersion: 1 } }).value;
    const runner = new WorkerRunner({ scheduler: repository, createHost: async () => fakeHost, workerId: "worker-1", leaseMs: 30_000 });

    await runner.runOnce();

    expect(fakeHost.resume).toHaveBeenCalledOnce();
    expect(fakeHost.startPrepared).not.toHaveBeenCalled();
    expect(repository.finishTask).toHaveBeenCalledWith(claimed.id, "worker-1", "completed", claimed.leaseVersion);
  });

  it("starts from the task prompt when the checkpoint fingerprint is stale", async () => {
    const claimed = task();
    const repository = scheduler(claimed);
    const fakeHost = host({ checkpoint: { taskFingerprint: "stale", projectVersion: 1 } }).value;
    const runner = new WorkerRunner({ scheduler: repository, createHost: async () => fakeHost, workerId: "worker-1", leaseMs: 30_000 });

    await runner.runOnce();

    expect(fakeHost.startPrepared).toHaveBeenCalledWith("Write chapter one", undefined);
    expect(fakeHost.resume).not.toHaveBeenCalled();
  });

  it("renews the lease while a task is executing", async () => {
    vi.useFakeTimers();
    try {
      const claimed = task();
      const repository = scheduler(claimed);
      let finish!: () => void;
      const execution = new Promise<void>((resolve) => { finish = resolve; });
      const fakeHost = host({ execute: () => execution }).value;
      const runner = new WorkerRunner({ scheduler: repository, createHost: async () => fakeHost, workerId: "worker-1", leaseMs: 300 });

      const running = runner.runOnce();
      await vi.advanceTimersByTimeAsync(100);
      expect(repository.renewLease).toHaveBeenCalledWith(claimed.id, "worker-1", 300, claimed.leaseVersion);
      finish();
      await running;
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops before a boundary when pause is requested", async () => {
    const claimed = task();
    const repository = scheduler(claimed, { desiredState: "paused", steerCommands: [] });
    let boundary!: () => Promise<void>;
    const fakeHost = host({ onBoundary: (handler) => { boundary = handler; }, execute: async () => { await boundary(); } }).value;
    const runner = new WorkerRunner({ scheduler: repository, createHost: async () => fakeHost, workerId: "worker-1", leaseMs: 30_000 });

    await runner.runOnce();

    expect(fakeHost.abort).toHaveBeenCalledWith("run paused");
    expect(repository.finishTask).toHaveBeenCalledWith(claimed.id, "worker-1", "paused", claimed.leaseVersion);
  });

  it("applies steer once at an agent boundary", async () => {
    const claimed = task();
    const command = { id: "steer-1", instruction: "Increase tension" };
    const repository = scheduler(claimed, { desiredState: "running", steerCommands: [command] });
    let boundary!: () => Promise<void>;
    const fakeHost = host({ onBoundary: (handler) => { boundary = handler; }, execute: async () => { await boundary(); await boundary(); } }).value;
    const runner = new WorkerRunner({ scheduler: repository, createHost: async () => fakeHost, workerId: "worker-1", leaseMs: 30_000 });

    await runner.runOnce();

    expect(fakeHost.steer).toHaveBeenCalledTimes(1);
    expect(fakeHost.steer).toHaveBeenCalledWith("steer-1", "Increase tension");
    expect(repository.acknowledgeSteerCommands).toHaveBeenCalledWith(claimed.id, "worker-1", claimed.leaseVersion, ["steer-1"]);
  });

  it("delivers a durable steer once after marker write and pre-ack crash", async () => {
    const firstTask = task({ leaseOwner: "worker-a", leaseVersion: 1 });
    const secondTask = task({ leaseOwner: "worker-b", leaseVersion: 2, attempts: 2 });
    const firstScope = { userId: firstTask.userId, projectId: firstTask.projectId, runId: firstTask.runId, taskFingerprint: taskFingerprint(firstTask), projectVersion: 1, lease: { taskId: firstTask.id, owner: "worker-a", version: 1 } };
    const firstStore = createMemoryDatabaseStore(firstScope);
    firstStore.backend.setLease(firstScope.lease);
    const config = { provider: "mock", model: "mock", providers: { mock: { api_key: "test" } }, roles: {} } as const;
    const crashedHost = await Host.new(config, {}, { agent: { run: async function* () {}, abort: vi.fn(), close: vi.fn() }, store: firstStore });
    await crashedHost.steer("steer-crash", "Raise the tension");
    await crashedHost.close();

    firstStore.backend.setLease({ taskId: secondTask.id, owner: "worker-b", version: 2 });
    const secondStore = createMemoryDatabaseStore({ ...firstScope, lease: { taskId: secondTask.id, owner: "worker-b", version: 2 } }, firstStore.backend);
    const prompts: string[] = [];
    const agent: RuntimeAgent = { run: async function* (prompt) { prompts.push(prompt); }, abort: vi.fn(), close: vi.fn() };
    const recoveredHost = await Host.new(config, {}, { agent, store: secondStore });
    const repository = scheduler(secondTask, { desiredState: "running", steerCommands: [{ id: "steer-crash", instruction: "Raise the tension" }] });
    await new WorkerRunner({ scheduler: repository, createHost: async () => recoveredHost, workerId: "worker-b", leaseMs: 30_000 }).runOnce();

    expect(prompts).toHaveLength(1);
    expect(prompts[0]?.match(/Raise the tension/g)).toHaveLength(1);
    expect(repository.acknowledgeSteerCommands).toHaveBeenCalledWith(secondTask.id, "worker-b", 2, ["steer-crash"]);
  });

  it("restarts from a safe boundary when the project version changed", async () => {
    const claimed = task({ projectVersion: 2 });
    const repository = scheduler(claimed);
    const fakeHost = host({ checkpoint: { taskFingerprint: taskFingerprint(claimed), projectVersion: 1 } }).value;

    await new WorkerRunner({ scheduler: repository, createHost: async () => fakeHost, workerId: "worker-1", leaseMs: 30_000 }).runOnce();

    expect(fakeHost.startPrepared).toHaveBeenCalledOnce();
    expect(fakeHost.resume).not.toHaveBeenCalled();
  });

  it("drains Host events and stream while executing", async () => {
    const claimed = task();
    const repository = scheduler(claimed);
    const fakeHost = host().value;
    const consumed: string[] = [];
    fakeHost.events = async function* () { consumed.push("event"); yield { type: "system", message: "started" } as never; };
    fakeHost.stream = async function* () { consumed.push("stream"); yield "text"; };

    await new WorkerRunner({ scheduler: repository, createHost: async () => fakeHost, workerId: "worker-1", leaseMs: 30_000 }).runOnce();

    expect(consumed).toEqual(["event", "stream"]);
  });

  it("propagates shutdown abort to the active Host execution", async () => {
    const claimed = task();
    const repository = scheduler(claimed);
    let observedSignal: AbortSignal | undefined;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const fakeHost = host({ execute: async (signal) => { observedSignal = signal; started(); await new Promise<void>((_resolve, reject) => signal?.addEventListener("abort", () => reject(signal.reason), { once: true })); } }).value;
    const controller = new AbortController();
    const running = new WorkerRunner({ scheduler: repository, createHost: async () => fakeHost, workerId: "worker-1", leaseMs: 30_000 }).runOnce(controller.signal);
    await ready;
    controller.abort(new Error("shutdown"));

    await expect(running).rejects.toThrow("shutdown");
    expect(observedSignal?.aborted).toBe(true);
  });

  it("treats a rejected error record or finish as lease loss", async () => {
    const claimed = task({ attempts: 1 });
    const repository = scheduler(claimed);
    vi.mocked(repository.recordTaskError).mockResolvedValue(false);
    const fakeHost = host({ execute: async () => { throw new Error("timeout"); } }).value;

    await expect(new WorkerRunner({ scheduler: repository, createHost: async () => fakeHost, workerId: "worker-1", leaseMs: 30_000 }).runOnce()).rejects.toThrow("lease ownership lost");
  });

  it("defers a pause received during commit until the transaction exits", async () => {
    const claimed = task();
    let control: RunResumeData = { desiredState: "running", steerCommands: [] };
    const repository = scheduler(claimed);
    vi.mocked(repository.readRunControl).mockImplementation(async () => control);
    let boundary!: (value?: "agent" | "commit:enter" | "commit:exit") => Promise<void>;
    const fakeHost = host({
      onBoundary: (handler) => { boundary = handler; },
      execute: async () => {
        await boundary("commit:enter");
        control = { desiredState: "paused", steerCommands: [] };
        expect(fakeHost.abort).not.toHaveBeenCalled();
        await boundary("commit:exit");
      },
    }).value;
    const runner = new WorkerRunner({ scheduler: repository, createHost: async () => fakeHost, workerId: "worker-1", leaseMs: 30_000 });

    await runner.runOnce();

    expect(fakeHost.abort).toHaveBeenCalledWith("run paused");
    expect(repository.finishTask).toHaveBeenCalledWith(claimed.id, "worker-1", "paused", claimed.leaseVersion);
  });

  it("fences the final task commit after lease ownership is lost", async () => {
    const claimed = task();
    const repository = scheduler(claimed);
    vi.mocked(repository.finishTask).mockResolvedValue(false);
    const fakeHost = host().value;
    const runner = new WorkerRunner({ scheduler: repository, createHost: async () => fakeHost, workerId: "worker-1", leaseMs: 30_000 });

    await expect(runner.runOnce()).rejects.toThrow("lease ownership lost");
    expect(vi.mocked(fakeHost.close).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(repository.finishTask).mock.invocationCallOrder[0]!);
    expect(repository.recordTaskError).toHaveBeenCalledWith(claimed.id, "worker-1", expect.objectContaining({ retryable: true }), claimed.leaseVersion);
  });

  it("persists retryable and terminal failures with distinct outcomes", async () => {
    const retryTask = task({ attempts: 1, maxAttempts: 3 });
    const retryScheduler = scheduler(retryTask);
    const retryHost = host({ execute: async () => { throw new Error("provider timeout"); } }).value;
    await new WorkerRunner({ scheduler: retryScheduler, createHost: async () => retryHost, workerId: "worker-1", leaseMs: 30_000 }).runOnce();
    expect(retryScheduler.recordTaskError).toHaveBeenCalledWith(retryTask.id, "worker-1", expect.objectContaining({ retryable: true, message: "provider timeout", category: "transient" }), retryTask.leaseVersion);
    expect(retryScheduler.finishTask).toHaveBeenCalledWith(retryTask.id, "worker-1", "queued", retryTask.leaseVersion);

    const finalTask = task({ attempts: 3, maxAttempts: 3 });
    const finalScheduler = scheduler(finalTask);
    const finalHost = host({ execute: async () => { throw new Error("invalid task payload"); } }).value;
    await new WorkerRunner({ scheduler: finalScheduler, createHost: async () => finalHost, workerId: "worker-1", leaseMs: 30_000 }).runOnce();
    expect(finalScheduler.recordTaskError).toHaveBeenCalledWith(finalTask.id, "worker-1", expect.objectContaining({ retryable: false }), finalTask.leaseVersion);
    expect(finalScheduler.finishTask).toHaveBeenCalledWith(finalTask.id, "worker-1", "failed", finalTask.leaseVersion);
  });
});
