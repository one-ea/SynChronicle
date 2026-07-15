import { createHash } from "node:crypto";
import type { ClaimedTask as SchedulerClaimedTask, ReleaseLeaseOutcome, RunResumeData } from "../scheduler/types.js";
import type { EventWakeup } from "../realtime/broker.js";
import type { NewRunEvent, RunEvent, RunEventScope } from "../realtime/eventRepository.js";
import type { RuntimeStreamChunk } from "../runtime/stream.js";
import { TaskExecutionError, taskError, taskPrompt, type WorkerBoundary } from "./commands.js";

export type ClaimedTask = SchedulerClaimedTask;

export interface WorkerHost {
  latestCheckpoint(): Promise<{ taskFingerprint: string; projectVersion: number } | null>;
  startPrepared(prompt: string, signal?: AbortSignal): Promise<void>;
  resume(signal?: AbortSignal): Promise<{ label: string | null; error?: Error }>;
  steer(commandId: string, instruction: string): Promise<void>;
  answerUser?(questionId: string, answers: Record<string, string>): Promise<void>;
  switchModel?(role: string, provider: string, model: string): Promise<void>;
  abort(reason: string): void;
  close(): Promise<void>;
  events?(): AsyncIterable<unknown>;
  stream?(): AsyncIterable<string | RuntimeStreamChunk>;
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
  setDurableCommit?(taskId: string, workerId: string, leaseVersion: number, active: boolean): Promise<boolean>;
  recordCommandFailure?(taskId: string, workerId: string, leaseVersion: number, commandId: string, error: { message: string; category: string; retryable: boolean }): Promise<boolean>;
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
      persistStream(host.stream?.(), scope, task.id, task.type, this.dependencies.eventSink),
    ].filter((value): value is Promise<void> => Boolean(value));
    const executionState: { outcome: ReleaseLeaseOutcome["status"] } = { outcome: "completed" };
    let leaseLost: TaskExecutionError | null = null;
    let renewalTimer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let hostClosed = false;
    let rejectHeartbeat!: (error: unknown) => void;
    let heartbeatFailed = false;
    const heartbeatFailure = new Promise<never>((_resolve, reject) => { rejectHeartbeat = reject; });

    const verifyLease = async () => {
      if (!await scheduler.renewLease(task.id, workerId, this.leaseMs, task.leaseVersion)) {
        leaseLost = new TaskExecutionError("lease ownership lost", true, { category: "lease_loss" });
        host.abort(leaseLost.message);
        throw leaseLost;
      }
    };
    const deliverCommands = async () => {
      const commands = await scheduler.claimSteerCommands(task.id, workerId, task.leaseVersion);
      for (const command of commands) {
        try { const interactive = parseInteractiveCommand(command.instruction); if (interactive?.kind === "answer" && host.answerUser) await host.answerUser(interactive.questionId, interactive.answers); else if (interactive?.kind === "model" && host.switchModel) await host.switchModel(interactive.role, interactive.provider, interactive.model); else await host.steer(command.id, command.instruction); if (!await scheduler.acknowledgeSteerCommands(task.id, workerId, task.leaseVersion, [command.id])) throw new TaskExecutionError("lease ownership lost while applying command", true, { category: "lease_loss" }); }
        catch (error) {
          const failure = taskError(error, 1, 3);
          if (failure.category === "lease_loss") { leaseLost = failure; host.abort(failure.message); throw failure; }
          if (scheduler.recordCommandFailure && !await scheduler.recordCommandFailure(task.id, workerId, task.leaseVersion, command.id, { message: failure.message, category: failure.category, retryable: failure.retryable })) {
            leaseLost = new TaskExecutionError("lease ownership lost while recording command failure", true, { category: "lease_loss" });
            host.abort(leaseLost.message);
            throw leaseLost;
          }
        }
      }
    };
    const scheduleRenewal = () => {
      renewalTimer = this.clock.setTimeout(() => {
        if (stopped) return;
        void (async () => {
          try {
            await verifyLease();
            await deliverCommands();
            if (!stopped) scheduleRenewal();
          } catch (error) {
            if (heartbeatFailed) return;
            heartbeatFailed = true;
            stopped = true;
            if (renewalTimer !== undefined) this.clock.clearTimeout(renewalTimer);
            const failure = leaseLost ?? taskError(error, task.attempts, task.maxAttempts);
            host.abort(failure.message);
            rejectHeartbeat(failure);
          }
        })();
      }, Math.max(1, Math.floor(this.leaseMs / 3))) as ReturnType<typeof setTimeout>;
    };
    const handleBoundary = async (boundary: WorkerBoundary = "agent") => {
      signal?.throwIfAborted();
      if (boundary === "commit:enter") { await verifyLease(); if (scheduler.setDurableCommit && !await scheduler.setDurableCommit(task.id, workerId, task.leaseVersion, true)) throw new TaskExecutionError("lease ownership lost entering durable commit", true, { category: "lease_loss" }); return; }
      if (boundary === "commit:exit" && scheduler.setDurableCommit && !await scheduler.setDurableCommit(task.id, workerId, task.leaseVersion, false)) throw new TaskExecutionError("lease ownership lost exiting durable commit", true, { category: "lease_loss" });
      const control = await scheduler.readRunControl(task.runId);
      if (control.desiredState === "paused" || control.desiredState === "cancelled") {
        executionState.outcome = control.desiredState === "paused" ? "paused" : "cancelled";
        const reason = control.desiredState === "paused" ? "run paused" : "run aborted";
        host.abort(reason);
        throw new TaskExecutionError(reason, false, { category: "cancel" });
      }
      await deliverCommands();
    };

    host.setBoundaryHandler(handleBoundary);
    const abortHost = () => { stopped = true; if (renewalTimer !== undefined) this.clock.clearTimeout(renewalTimer); host.abort(signal?.reason instanceof Error ? signal.reason.message : "worker shutdown"); };
    signal?.addEventListener("abort", abortHost, { once: true });
    try {
      if (!await scheduler.startTask(task.id, workerId, task.leaseVersion)) throw new TaskExecutionError("lease ownership lost before task start", true, { category: "lease_loss" });
      scheduleRenewal();
      await Promise.race([(async () => {
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
      })(), heartbeatFailure]);
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

function parseInteractiveCommand(instruction: string):
  | { kind: "answer"; questionId: string; answers: Record<string, string> }
  | { kind: "model"; role: string; provider: string; model: string }
  | null {
  const answerPrefix = "[AskUser] ";
  const modelPrefix = "[ModelSwitch] ";
  try {
    if (instruction.startsWith(answerPrefix)) {
      const value = JSON.parse(instruction.slice(answerPrefix.length)) as { questionId?: unknown; answers?: unknown };
      if (typeof value.questionId === "string" && value.answers && typeof value.answers === "object" && !Array.isArray(value.answers) && Object.values(value.answers).every((answer) => typeof answer === "string")) {
        return { kind: "answer", questionId: value.questionId, answers: value.answers as Record<string, string> };
      }
    }
    if (instruction.startsWith(modelPrefix)) {
      const value = JSON.parse(instruction.slice(modelPrefix.length)) as Record<string, unknown>;
      if (typeof value.role === "string" && typeof value.provider === "string" && typeof value.model === "string") return { kind: "model", role: value.role, provider: value.provider, model: value.model };
    }
  } catch {
    return null;
  }
  return null;
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

function persistStream(
  iterable: AsyncIterable<string | RuntimeStreamChunk> | undefined,
  scope: RunEventScope,
  taskId: string,
  agent: string,
  sink: WorkerRunnerDependencies["eventSink"],
): Promise<void> | undefined {
  if (!iterable) return undefined;
  return (async () => {
    let chunkSequence = 0;
    for await (const value of iterable) {
      if (!sink) continue;
      const chunk = typeof value === "string" ? { sequence: chunkSequence + 1, text: value } : value;
      chunkSequence = chunk.sequence;
      if (chunk.eventSequence !== undefined) {
        await sink.publish({ runId: scope.runId, sequence: chunk.eventSequence });
        continue;
      }
      const event = await sink.appendEvent(scope, {
        stableId: `stream:${scope.runId}:${taskId}:${agent}:${chunkSequence}`,
        type: "stream.delta",
        payload: { taskId, agent, chunkSequence, text: chunk.text },
      });
      await sink.publish({ runId: event.runId, sequence: event.sequence });
    }
  })();
}

function eventType(value: unknown): string {
  if (value && typeof value === "object") {
    const payload = "payload" in value && value.payload && typeof value.payload === "object" ? value.payload as Record<string, unknown> : {};
    if (typeof payload.publicType === "string") return payload.publicType;
    if ("type" in value && typeof value.type === "string") return value.type;
  }
  return "system";
}

function eventStableId(value: unknown): string | null {
  if (value && typeof value === "object" && "id" in value && typeof value.id === "string") return value.id;
  return null;
}
