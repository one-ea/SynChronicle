import { createHash } from "node:crypto";
import type { ClaimedTask as SchedulerClaimedTask, ReleaseLeaseOutcome, RunResumeData } from "../scheduler/types.js";
import type { EventWakeup } from "../realtime/broker.js";
import type { NewRunEvent, RunEvent, RunEventScope } from "../realtime/eventRepository.js";
import { TaskExecutionError, taskError, taskPrompt, type WorkerBoundary } from "./commands.js";

export type ClaimedTask = SchedulerClaimedTask;

export interface WorkerHost {
  latestCheckpoint(): Promise<{ taskFingerprint: string; projectVersion: number } | null>;
  startPrepared(prompt: string, signal?: AbortSignal): Promise<void>;
  resume(signal?: AbortSignal): Promise<{ label: string | null; error?: Error }>;
  steer(commandId: string, instruction: string): Promise<void>;
  abort(reason: string): void;
  close(): Promise<void>;
  events?(): AsyncIterable<unknown>;
  stream?(): AsyncIterable<string>;
  setBoundaryHandler(handler: (boundary?: WorkerBoundary) => Promise<void>): void;
}

export interface WorkerScheduler {
  claimNextTask(workerId: string, leaseMs: number): Promise<ClaimedTask | null>;
  startTask(taskId: string, workerId: string, leaseVersion: number): Promise<boolean>;
  renewLease(taskId: string, workerId: string, leaseMs: number, leaseVersion: number): Promise<boolean>;
  readRunControl(runId: string): Promise<RunResumeData>;
  claimSteerCommands(taskId: string, workerId: string, leaseVersion: number): Promise<Array<{ id: string; instruction: string }>>;
  acknowledgeSteerCommands(taskId: string, workerId: string, leaseVersion: number, commandIds: string[]): Promise<boolean>;
  finishTask(taskId: string, workerId: string, status: ReleaseLeaseOutcome["status"], leaseVersion: number): Promise<boolean>;
  recordTaskError(taskId: string, workerId: string, error: { message: string; stack?: string; retryable: boolean; category: string }, leaseVersion: number): Promise<boolean>;
  recordTaskControl(taskId: string, workerId: string, control: "paused" | "cancelled", leaseVersion: number): Promise<boolean>;
}

export interface WorkerRunnerDependencies {
  scheduler: WorkerScheduler;
  createHost(task: ClaimedTask): Promise<WorkerHost>;
  workerId: string;
  leaseMs?: number;
  idleMs?: number;
  clock?: Pick<typeof globalThis, "setTimeout" | "clearTimeout">;
  eventSink?: {
    appendEvent(scope: RunEventScope, event: NewRunEvent): Promise<RunEvent>;
    publish(wakeup: EventWakeup): Promise<void>;
  };
}

export function taskFingerprint(task: ClaimedTask): string {
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

  async executeTask(task: ClaimedTask, signal?: AbortSignal): Promise<void> {
    const { scheduler, workerId } = this.dependencies;
    const host = await this.dependencies.createHost(task);
    const scope = { userId: task.userId, projectId: task.projectId, runId: task.runId };
    const drains = [
      persist(host.events?.(), (value) => ({
        stableId: eventStableId(value),
        type: eventType(value),
        payload: value,
      }), scope, this.dependencies.eventSink),
      persist(host.stream?.(), (value) => ({
        stableId: null,
        type: "stream.delta",
        payload: { agent: task.type, text: String(value) },
      }), scope, this.dependencies.eventSink),
    ].filter((value): value is Promise<void> => Boolean(value));
    const executionState: { outcome: ReleaseLeaseOutcome["status"] } = { outcome: "completed" };
    let leaseLost: TaskExecutionError | null = null;
    let renewalTimer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let hostClosed = false;

    const verifyLease = async () => {
      if (!await scheduler.renewLease(task.id, workerId, this.leaseMs, task.leaseVersion)) {
        leaseLost = new TaskExecutionError("lease ownership lost", true, { category: "lease_loss" });
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
        throw new TaskExecutionError(reason, false, { category: "cancel" });
      }
      const commands = await scheduler.claimSteerCommands(task.id, workerId, task.leaseVersion);
      for (const command of commands) {
        await host.steer(command.id, command.instruction);
      }
      if (commands.length && !await scheduler.acknowledgeSteerCommands(task.id, workerId, task.leaseVersion, commands.map(({ id }) => id))) {
        throw new TaskExecutionError("lease ownership lost while applying steer", true, { category: "lease_loss" });
      }
    };

    host.setBoundaryHandler(handleBoundary);
    const abortHost = () => { stopped = true; if (renewalTimer !== undefined) this.clock.clearTimeout(renewalTimer); host.abort(signal?.reason instanceof Error ? signal.reason.message : "worker shutdown"); };
    signal?.addEventListener("abort", abortHost, { once: true });
    try {
      if (!await scheduler.startTask(task.id, workerId, task.leaseVersion)) throw new TaskExecutionError("lease ownership lost before task start", true, { category: "lease_loss" });
      scheduleRenewal();
      const checkpoint = await host.latestCheckpoint();
      if (checkpoint?.taskFingerprint === taskFingerprint(task) && checkpoint.projectVersion === task.projectVersion) {
        const resumed = await host.resume(signal);
        if (resumed.error) throw resumed.error;
      } else {
        await host.startPrepared(taskPrompt(task.payload), signal);
      }
      await verifyLease();
      await host.close();
      hostClosed = true;
      await Promise.all(drains);
      await verifyLease();
      if (!await scheduler.finishTask(task.id, workerId, "completed", task.leaseVersion)) throw new TaskExecutionError("lease ownership lost before final commit", true, { category: "lease_loss" });
    } catch (error) {
      let failure = leaseLost ?? taskError(error, task.attempts, task.maxAttempts);
      if (!hostClosed) {
        try { await host.close(); hostClosed = true; } catch (closeError) { failure = taskError(closeError, task.attempts, task.maxAttempts); }
      }
      await Promise.all(drains);
      if (signal?.aborted) throw signal.reason;
      const outcome = executionState.outcome;
      const controlled = outcome === "paused" || outcome === "cancelled";
      const recorded = controlled
        ? await scheduler.recordTaskControl(task.id, workerId, outcome as "paused" | "cancelled", task.leaseVersion)
        : await scheduler.recordTaskError(task.id, workerId, { message: failure.message, stack: failure.stack, retryable: failure.retryable, category: failure.category }, task.leaseVersion);
      if (!recorded) throw new TaskExecutionError("lease ownership lost while recording failure", true, { category: "lease_loss" });
      if (controlled && !await scheduler.finishTask(task.id, workerId, outcome, task.leaseVersion)) throw new TaskExecutionError("lease ownership lost while applying control", true, { category: "lease_loss" });
      else if (failure.message.includes("lease ownership lost")) throw failure;
      else if (!controlled && !await scheduler.finishTask(task.id, workerId, failure.retryable ? "queued" : "failed", task.leaseVersion)) throw new TaskExecutionError("lease ownership lost while finishing failure", true, { category: "lease_loss" });
    } finally {
      stopped = true;
      if (renewalTimer !== undefined) this.clock.clearTimeout(renewalTimer);
      signal?.removeEventListener("abort", abortHost);
      if (!hostClosed) await host.close().catch(() => undefined);
    }
  }
}

export async function executeTask(task: ClaimedTask, signal: AbortSignal | undefined, dependencies: WorkerRunnerDependencies): Promise<void> {
  await new WorkerRunner(dependencies).executeTask(task, signal);
}

function delay(ms: number, signal: AbortSignal, clock: Pick<typeof globalThis, "setTimeout" | "clearTimeout">): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = clock.setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clock.clearTimeout(timer); reject(signal.reason); }, { once: true });
  });
}

function persist(
  iterable: AsyncIterable<unknown> | undefined,
  map: (value: unknown) => NewRunEvent,
  scope: RunEventScope,
  sink: WorkerRunnerDependencies["eventSink"],
): Promise<void> | undefined {
  if (!iterable) return undefined;
  return (async () => {
    for await (const value of iterable) {
      if (!sink) continue;
      const event = await sink.appendEvent(scope, map(value));
      await sink.publish({ runId: event.runId, sequence: event.sequence });
    }
  })();
}

function eventType(value: unknown): string {
  if (value && typeof value === "object" && "type" in value && typeof value.type === "string") return value.type;
  return "system";
}

function eventStableId(value: unknown): string | null {
  if (value && typeof value === "object" && "id" in value && typeof value.id === "string") return value.id;
  return null;
}
