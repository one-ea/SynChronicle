import { createHash } from "node:crypto";
import type { ReleaseLeaseOutcome, RunResumeData, TaskRow } from "../scheduler/types.js";
import { pendingSteer, TaskExecutionError, taskError, taskPrompt, type WorkerBoundary } from "./commands.js";

export interface WorkerHost {
  latestCheckpointFingerprint(): Promise<string | null>;
  startPrepared(prompt: string): Promise<void>;
  resume(): Promise<{ label: string | null; error?: Error }>;
  steer(instruction: string): Promise<void>;
  abort(reason: string): void;
  close(): Promise<void>;
  setBoundaryHandler(handler: (boundary?: WorkerBoundary) => Promise<void>): void;
}

export interface WorkerScheduler {
  claimNextTask(workerId: string, leaseMs: number): Promise<TaskRow | null>;
  startTask(taskId: string, workerId: string): Promise<boolean>;
  renewLease(taskId: string, workerId: string, leaseMs: number): Promise<boolean>;
  readRunControl(runId: string): Promise<RunResumeData>;
  applySteerCommands(runId: string, workerId: string, commandIds: string[]): Promise<boolean>;
  finishTask(taskId: string, workerId: string, status: ReleaseLeaseOutcome["status"]): Promise<boolean>;
  recordTaskError(taskId: string, workerId: string, error: { message: string; stack?: string; retryable: boolean }): Promise<boolean>;
}

export interface WorkerRunnerDependencies {
  scheduler: WorkerScheduler;
  createHost(task: TaskRow): Promise<WorkerHost>;
  workerId: string;
  leaseMs?: number;
  idleMs?: number;
  clock?: Pick<typeof globalThis, "setTimeout" | "clearTimeout">;
}

export function taskFingerprint(task: TaskRow): string {
  return createHash("sha256").update(JSON.stringify({ type: task.type, payload: task.payload })).digest("hex");
}

export class WorkerRunner {
  private readonly leaseMs: number;
  private readonly idleMs: number;
  private readonly clock: Pick<typeof globalThis, "setTimeout" | "clearTimeout">;

  constructor(private readonly dependencies: WorkerRunnerDependencies) {
    this.leaseMs = dependencies.leaseMs ?? 30_000;
    this.idleMs = dependencies.idleMs ?? 1_000;
    this.clock = dependencies.clock ?? globalThis;
  }

  async runOnce(signal?: AbortSignal): Promise<boolean> {
    signal?.throwIfAborted();
    const task = await this.dependencies.scheduler.claimNextTask(this.dependencies.workerId, this.leaseMs);
    if (!task) return false;
    await this.executeTask(task, signal);
    return true;
  }

  async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      let worked = false;
      try { worked = await this.runOnce(signal); } catch (error) { if (signal.aborted) throw error; }
      if (!worked) await delay(this.idleMs, signal, this.clock);
    }
  }

  async executeTask(task: TaskRow, signal?: AbortSignal): Promise<void> {
    const { scheduler, workerId } = this.dependencies;
    const host = await this.dependencies.createHost(task);
    const appliedCommands = new Set<string>();
    const executionState: { outcome: ReleaseLeaseOutcome["status"] } = { outcome: "completed" };
    let leaseLost: TaskExecutionError | null = null;
    let renewalTimer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let hostClosed = false;

    const verifyLease = async () => {
      if (!await scheduler.renewLease(task.id, workerId, this.leaseMs)) {
        leaseLost = new TaskExecutionError("lease ownership lost", true);
        host.abort(leaseLost.message);
        throw leaseLost;
      }
    };
    const scheduleRenewal = () => {
      renewalTimer = this.clock.setTimeout(async () => {
        if (stopped) return;
        try { await verifyLease(); } catch { return; }
        scheduleRenewal();
      }, Math.max(1, Math.floor(this.leaseMs / 3))) as ReturnType<typeof setTimeout>;
    };
    const handleBoundary = async (boundary: WorkerBoundary = "agent") => {
      signal?.throwIfAborted();
      if (boundary === "commit:enter") await verifyLease();
      if (boundary === "commit:enter") return;
      const control = await scheduler.readRunControl(task.runId);
      if (control.desiredState === "paused" || control.desiredState === "cancelled") {
        executionState.outcome = control.desiredState === "paused" ? "paused" : "cancelled";
        const reason = control.desiredState === "paused" ? "run paused" : "run aborted";
        host.abort(reason);
        throw new TaskExecutionError(reason, false);
      }
      const commands = pendingSteer(control, appliedCommands);
      for (const command of commands) {
        await host.steer(command.instruction);
        appliedCommands.add(command.id);
      }
      if (commands.length && !await scheduler.applySteerCommands(task.runId, workerId, commands.map(({ id }) => id))) {
        throw new TaskExecutionError("lease ownership lost while applying steer", true);
      }
    };

    host.setBoundaryHandler(handleBoundary);
    try {
      if (!await scheduler.startTask(task.id, workerId)) throw new TaskExecutionError("lease ownership lost before task start", true);
      scheduleRenewal();
      const checkpoint = await host.latestCheckpointFingerprint();
      if (checkpoint === taskFingerprint(task)) {
        const resumed = await host.resume();
        if (resumed.error) throw resumed.error;
      } else {
        await host.startPrepared(taskPrompt(task.payload));
      }
      await verifyLease();
      await host.close();
      hostClosed = true;
      await verifyLease();
      if (!await scheduler.finishTask(task.id, workerId, "completed")) throw new TaskExecutionError("lease ownership lost before final commit", true);
    } catch (error) {
      let failure = leaseLost ?? taskError(error, task.attempts, task.maxAttempts);
      if (!hostClosed) {
        try { await host.close(); hostClosed = true; } catch (closeError) { failure = taskError(closeError, task.attempts, task.maxAttempts); }
      }
      const outcome = executionState.outcome;
      const controlled = outcome === "paused" || outcome === "cancelled";
      await scheduler.recordTaskError(task.id, workerId, { message: failure.message, stack: failure.stack, retryable: controlled ? false : failure.retryable });
      if (controlled) await scheduler.finishTask(task.id, workerId, outcome);
      else if (failure.message.includes("lease ownership lost")) throw failure;
      else await scheduler.finishTask(task.id, workerId, failure.retryable ? "queued" : "failed");
    } finally {
      stopped = true;
      if (renewalTimer !== undefined) this.clock.clearTimeout(renewalTimer);
      if (!hostClosed) await host.close().catch(() => undefined);
    }
  }
}

export async function executeTask(task: TaskRow, signal: AbortSignal | undefined, dependencies: WorkerRunnerDependencies): Promise<void> {
  await new WorkerRunner(dependencies).executeTask(task, signal);
}

function delay(ms: number, signal: AbortSignal, clock: Pick<typeof globalThis, "setTimeout" | "clearTimeout">): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = clock.setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clock.clearTimeout(timer); reject(signal.reason); }, { once: true });
  });
}
