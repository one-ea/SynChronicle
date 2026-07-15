import { createHash } from "node:crypto";
import { and, asc, count, eq, inArray, lte, or, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { projects, runCommands, runs, tasks, users } from "../db/schema/index.js";
import { appendRunEventInTransaction } from "../realtime/append.js";
import type { RequestAuth } from "../web/auth/plugin.js";
import { LEGACY_COMMAND_ID_PREFIX } from "./types.js";
import type {
  EnqueueRunInput,
  ClaimedTask,
  ReleaseLeaseOutcome,
  RunCommand,
  RunCommandResult,
  RunResumeData,
  RunRow,
} from "./types.js";

const activeTaskStatuses = ["leased", "running"] as const;
const terminalRunStatuses = ["completed", "failed", "cancelled"] as const;
const schedulerAdvisoryLock = 0x53594e43;

export interface SchedulerRepositoryOptions {
  platformConcurrency: number;
}

type SchedulerExecutor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

function legacyCommandId(index: number, instruction: string): string {
  const digest = createHash("sha256").update(`${index}\0${instruction}`).digest("hex").slice(0, 16);
  return `${LEGACY_COMMAND_ID_PREFIX}${index}:${digest}`;
}

export function normalizeRunResumeData(value: unknown): RunResumeData {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const desiredState = source.desiredState === "paused" || source.desiredState === "cancelled"
    ? source.desiredState
    : "running";
  const commands: RunResumeData["steerCommands"] = [];
  const seen = new Set<string>();
  if (Array.isArray(source.steerCommands)) {
    source.steerCommands.forEach((candidate, index) => {
      let id: string | undefined;
      let instruction: string | undefined;
      if (typeof candidate === "string" && candidate.trim()) {
        id = legacyCommandId(index, candidate);
        instruction = candidate;
      } else if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
        const record = candidate as Record<string, unknown>;
        const candidateId = typeof record.id === "string" ? record.id : record.commandId;
        if (typeof candidateId === "string" && candidateId.trim() && typeof record.instruction === "string" && record.instruction.trim()) {
          id = candidateId;
          instruction = record.instruction;
        }
      }
      if (id && instruction && !seen.has(id)) {
        seen.add(id);
        commands.push({ id, instruction });
      }
    });
  }
  return { ...source, desiredState, steerCommands: commands };
}

export function buildReleaseLeaseQuery(
  executor: SchedulerExecutor,
  taskId: string,
  workerId: string,
  outcome: ReleaseLeaseOutcome,
  now: Date,
) {
  return executor.update(tasks).set({
    status: outcome.status,
    scheduledAt: outcome.scheduledAt ?? now,
    leaseOwner: null,
    leaseExpiresAt: null,
    updatedAt: now,
  }).where(and(
    eq(tasks.id, taskId),
    eq(tasks.leaseOwner, workerId),
    inArray(tasks.status, activeTaskStatuses),
    sql`${tasks.leaseExpiresAt} > ${now}`,
  )).returning({ id: tasks.id });
}

export function buildEligibleTaskQuery(executor: SchedulerExecutor, now: Date) {
  return executor.select({ task: tasks, projectVersion: projects.version })
    .from(tasks)
    .innerJoin(users, eq(tasks.userId, users.id))
    .innerJoin(projects, and(eq(tasks.projectId, projects.id), eq(tasks.userId, projects.userId)))
    .innerJoin(runs, and(
      eq(tasks.runId, runs.id),
      eq(tasks.userId, runs.userId),
      eq(tasks.projectId, runs.projectId),
    ))
    .where(and(
      eq(tasks.status, "queued"),
      sql`${tasks.attempts} < ${tasks.maxAttempts}`,
      lte(tasks.scheduledAt, now),
      eq(users.status, "active"),
      sql`coalesce(${runs.resumeData}->>'desiredState' not in ('paused', 'cancelled'), true)`,
      sql`(select count(*) from tasks active_user where active_user.user_id = ${tasks.userId} and active_user.status in ('leased', 'running')) < ${users.concurrencyLimit}`,
      sql`(${tasks.type} <> 'write' or not exists (select 1 from tasks active_write where active_write.project_id = ${tasks.projectId} and active_write.type = 'write' and active_write.status in ('leased', 'running')))`,
    ))
    .orderBy(sql`${tasks.priority} desc`, asc(tasks.createdAt))
    .limit(1)
    .for("update", { skipLocked: true });
}

export class SchedulerRepository {
  private readonly platformConcurrency: number;

  constructor(private readonly db: Database, options: SchedulerRepositoryOptions = { platformConcurrency: 4 }) {
    if (!Number.isInteger(options.platformConcurrency) || options.platformConcurrency <= 0) {
      throw new Error("platformConcurrency must be a positive integer");
    }
    this.platformConcurrency = options.platformConcurrency;
  }

  async enqueueRun(auth: RequestAuth, projectId: string, input: EnqueueRunInput): Promise<RunRow | null> {
    return this.db.transaction(async (transaction) => {
      const [project] = await transaction.select({ id: projects.id }).from(projects).where(and(
        eq(projects.id, projectId),
        eq(projects.userId, auth.userId),
        eq(projects.status, "active"),
      )).limit(1).for("update");
      if (!project) return null;

      const [existing] = await transaction.select().from(runs).where(and(
        eq(runs.userId, auth.userId),
        eq(runs.projectId, projectId),
        eq(runs.idempotencyKey, input.idempotencyKey),
      )).limit(1);
      if (existing) return existing;

      const [run] = await transaction.insert(runs).values({
        userId: auth.userId,
        projectId,
        idempotencyKey: input.idempotencyKey,
        budgetSnapshot: input.budgetSnapshot ?? {},
        resumeData: { desiredState: "running", steerCommands: [] } satisfies RunResumeData,
      }).returning();
      if (!run) throw new Error("Run insert returned no row");
      await transaction.insert(tasks).values({
        userId: auth.userId,
        projectId,
        runId: run.id,
        type: input.type ?? "write",
        priority: input.priority ?? 0,
        payload: input.payload ?? {},
      });
      return run;
    });
  }

  async claimNextTask(workerId: string, leaseMs: number): Promise<ClaimedTask | null> {
    if (!workerId.trim()) throw new Error("workerId must not be empty");
    if (!Number.isInteger(leaseMs) || leaseMs <= 0) throw new Error("leaseMs must be a positive integer");
    return this.db.transaction(async (transaction) => {
      await transaction.execute(sql`select pg_advisory_xact_lock(${schedulerAdvisoryLock})`);
      const now = new Date();

      await transaction.update(tasks).set({
        status: "failed",
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: now,
      }).where(and(
        inArray(tasks.status, activeTaskStatuses),
        lte(tasks.leaseExpiresAt, now),
        sql`${tasks.attempts} >= ${tasks.maxAttempts}`,
      ));
      await transaction.update(tasks).set({
        status: "failed",
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: now,
      }).where(and(
        eq(tasks.status, "queued"),
        sql`${tasks.attempts} >= ${tasks.maxAttempts}`,
      ));
      await transaction.update(tasks).set({
        status: "queued",
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: now,
      }).where(and(
        inArray(tasks.status, activeTaskStatuses),
        lte(tasks.leaseExpiresAt, now),
        sql`${tasks.attempts} < ${tasks.maxAttempts}`,
      ));

      const [{ value: platformActive = 0 } = {}] = await transaction
        .select({ value: count() })
        .from(tasks)
        .where(inArray(tasks.status, activeTaskStatuses));
      if (platformActive >= this.platformConcurrency) return null;

      const [candidate] = await buildEligibleTaskQuery(transaction, now);
      if (!candidate) return null;
      const [claimed] = await transaction.update(tasks).set({
        status: "leased",
        leaseOwner: workerId,
        leaseExpiresAt: new Date(now.getTime() + leaseMs),
        leaseVersion: sql`${tasks.leaseVersion} + 1`,
        attempts: sql`${tasks.attempts} + 1`,
        updatedAt: now,
      }).where(and(eq(tasks.id, candidate.task.id), eq(tasks.status, "queued"))).returning();
      return claimed ? { ...claimed, projectVersion: candidate.projectVersion } : null;
    });
  }

  async renewLease(taskId: string, workerId: string, leaseMs: number, leaseVersion?: number): Promise<boolean> {
    if (!Number.isInteger(leaseMs) || leaseMs <= 0) throw new Error("leaseMs must be a positive integer");
    const now = new Date();
    const [renewed] = await this.db.update(tasks).set({
      leaseExpiresAt: new Date(now.getTime() + leaseMs),
      updatedAt: now,
    }).where(and(
      eq(tasks.id, taskId),
      eq(tasks.leaseOwner, workerId),
      leaseVersion === undefined ? undefined : eq(tasks.leaseVersion, leaseVersion),
      inArray(tasks.status, activeTaskStatuses),
      sql`${tasks.leaseExpiresAt} > ${now}`,
    )).returning({ id: tasks.id });
    return Boolean(renewed);
  }

  async startTask(taskId: string, workerId: string, leaseVersion?: number): Promise<boolean> {
    const now = new Date();
    return this.db.transaction(async (transaction) => {
      const [started] = await transaction.update(tasks).set({ status: "running", updatedAt: now }).where(and(
        eq(tasks.id, taskId),
        eq(tasks.leaseOwner, workerId),
        leaseVersion === undefined ? undefined : eq(tasks.leaseVersion, leaseVersion),
        eq(tasks.status, "leased"),
        sql`${tasks.leaseExpiresAt} > ${now}`,
      )).returning({ runId: tasks.runId });
      if (!started) return false;
      await transaction.update(runs).set({ status: "running", startedAt: sql`coalesce(${runs.startedAt}, ${now})`, updatedAt: now })
        .where(eq(runs.id, started.runId));
      return true;
    });
  }

  async readRunControl(runId: string): Promise<RunResumeData> {
    const [run] = await this.db.select({ resumeData: runs.resumeData }).from(runs).where(eq(runs.id, runId)).limit(1);
    if (!run) throw new Error(`run ${runId} is missing`);
    return normalizeRunResumeData(run.resumeData);
  }

  async claimSteerCommands(taskId: string, workerId: string, leaseVersion: number): Promise<Array<{ id: string; instruction: string }>> {
    const now = new Date();
    return this.db.transaction(async (transaction) => {
      const [owned] = await transaction.select({ runId: tasks.runId }).from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.leaseOwner, workerId), eq(tasks.leaseVersion, leaseVersion), inArray(tasks.status, activeTaskStatuses), sql`${tasks.leaseExpiresAt} > ${now}`)).limit(1).for("update");
      if (!owned) return [];
      const commands = await transaction.select().from(runCommands).where(and(eq(runCommands.runId, owned.runId), or(eq(runCommands.status, "pending"), and(eq(runCommands.status, "claimed"), or(sql`${runCommands.claimedBy} is distinct from ${workerId}`, sql`${runCommands.claimedLeaseVersion} is distinct from ${leaseVersion}`))))).orderBy(asc(runCommands.createdAt)).for("update");
      if (!commands.length) return [];
      await transaction.update(runCommands).set({ status: "claimed", claimedBy: workerId, claimedLeaseVersion: leaseVersion, updatedAt: now }).where(inArray(runCommands.id, commands.map(({ id }) => id)));
      return commands.map(({ commandId: id, instruction }) => ({ id, instruction }));
    });
  }

  async acknowledgeSteerCommands(taskId: string, workerId: string, leaseVersion: number, commandIds: string[]): Promise<boolean> {
    if (!commandIds.length) return true;
    const now = new Date();
    return this.db.transaction(async (transaction) => {
      const [owned] = await transaction.select({ runId: tasks.runId }).from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.leaseOwner, workerId), eq(tasks.leaseVersion, leaseVersion), inArray(tasks.status, activeTaskStatuses), sql`${tasks.leaseExpiresAt} > ${now}`)).limit(1).for("update");
      if (!owned) return false;
      const applied = await transaction.update(runCommands).set({ status: "applied", appliedAt: now, updatedAt: now }).where(and(eq(runCommands.runId, owned.runId), inArray(runCommands.commandId, commandIds), eq(runCommands.status, "claimed"), eq(runCommands.claimedBy, workerId), eq(runCommands.claimedLeaseVersion, leaseVersion))).returning({ id: runCommands.id });
      if (applied.length !== commandIds.length) return false;
      const [run] = await transaction.select().from(runs).where(eq(runs.id, owned.runId)).limit(1).for("update");
      if (run) { const resumeData = normalizeRunResumeData(run.resumeData); await transaction.update(runs).set({ resumeData: { ...resumeData, steerCommands: resumeData.steerCommands.filter(({ id }) => !commandIds.includes(id)) }, updatedAt: now }).where(eq(runs.id, owned.runId)); }
      return true;
    });
  }

  async finishTask(taskId: string, workerId: string, status: ReleaseLeaseOutcome["status"], leaseVersion?: number): Promise<boolean> {
    const now = new Date();
    return this.db.transaction(async (transaction) => {
      await transaction.execute(sql`select pg_advisory_xact_lock(${schedulerAdvisoryLock})`);
      const [task] = await transaction.select({ runId: tasks.runId }).from(tasks).where(and(
        eq(tasks.id, taskId),
        eq(tasks.leaseOwner, workerId),
        leaseVersion === undefined ? undefined : eq(tasks.leaseVersion, leaseVersion),
        inArray(tasks.status, activeTaskStatuses),
        sql`${tasks.leaseExpiresAt} > ${now}`,
      )).limit(1).for("update");
      if (!task) return false;
      const [released] = await buildReleaseLeaseQuery(transaction, taskId, workerId, { status }, now);
      if (!released) return false;
      const runStatus = status === "queued" ? "queued" : status;
      await transaction.update(runs).set({
        status: runStatus,
        completedAt: status === "completed" || status === "failed" || status === "cancelled" ? now : null,
        updatedAt: now,
      }).where(eq(runs.id, task.runId));
      return true;
    });
  }

  async recordTaskError(taskId: string, workerId: string, error: { message: string; stack?: string; retryable: boolean; category?: string }, leaseVersion?: number): Promise<boolean> {
    const now = new Date();
    return this.db.transaction(async (transaction) => {
      const [task] = await transaction.select().from(tasks).where(and(
        eq(tasks.id, taskId),
        eq(tasks.leaseOwner, workerId),
        leaseVersion === undefined ? undefined : eq(tasks.leaseVersion, leaseVersion),
        inArray(tasks.status, activeTaskStatuses),
        sql`${tasks.leaseExpiresAt} > ${now}`,
      )).limit(1).for("update");
      if (!task) return false;
      const stableId = `error:${task.id}:${leaseVersion ?? task.leaseVersion}:${error.category ?? "internal"}`;
      await appendRunEventInTransaction(transaction as unknown as Database, task, {
        stableId,
        type: "ui_event",
        payload: (sequence: number) => ({ seq: sequence, time: now.toISOString(), kind: "ui_event", priority: "control", category: "WORKER.ERROR", summary: error.message, payload: { id: stableId, type: "error", message: error.message, stack: error.stack, retryable: error.retryable, category: error.category, taskId } }),
      });
      return true;
    });
  }

  async recordTaskControl(taskId: string, workerId: string, control: "paused" | "cancelled", leaseVersion: number): Promise<boolean> {
    const now = new Date();
    return this.db.transaction(async (transaction) => {
      const [task] = await transaction.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.leaseOwner, workerId), eq(tasks.leaseVersion, leaseVersion), inArray(tasks.status, activeTaskStatuses), sql`${tasks.leaseExpiresAt} > ${now}`)).limit(1).for("update");
      if (!task) return false;
      const stableId = `control:${task.id}:${leaseVersion}:${control}`;
      await appendRunEventInTransaction(transaction as unknown as Database, task, { stableId, type: "ui_event", payload: (sequence: number) => ({ seq: sequence, time: now.toISOString(), kind: "ui_event", priority: "control", category: "WORKER.CONTROL", summary: control, payload: { id: stableId, type: "control", control, taskId } }) });
      return true;
    });
  }

  async releaseLease(taskId: string, workerId: string, outcome: ReleaseLeaseOutcome): Promise<boolean> {
    return this.db.transaction(async (transaction) => {
      await transaction.execute(sql`select pg_advisory_xact_lock(${schedulerAdvisoryLock})`);
      const [released] = await buildReleaseLeaseQuery(transaction, taskId, workerId, outcome, new Date());
      return Boolean(released);
    });
  }

  async command(
    auth: RequestAuth,
    projectId: string,
    runId: string,
    command: RunCommand,
    payload?: unknown,
  ): Promise<RunCommandResult> {
    return this.db.transaction(async (transaction) => {
      const [run] = await transaction.select().from(runs).where(and(
        eq(runs.id, runId),
        eq(runs.projectId, projectId),
        eq(runs.userId, auth.userId),
      )).limit(1).for("update");
      if (!run) return "missing";
      if (run.status === "cancelled" && command === "abort") return run;
      if (terminalRunStatuses.includes(run.status as typeof terminalRunStatuses[number])) return "conflict";

      const resumeData = normalizeRunResumeData(run.resumeData);
      const normalizationChanged = JSON.stringify(resumeData) !== JSON.stringify(run.resumeData);
      if (resumeData.desiredState === "cancelled" && command !== "abort") return "conflict";
      let next: RunResumeData;
      if (command === "steer") {
        if (!payload || typeof payload !== "object") return "conflict";
        const { commandId, instruction } = payload as { commandId?: unknown; instruction?: unknown };
        if (
          typeof commandId !== "string"
          || !commandId.trim()
          || commandId.startsWith(LEGACY_COMMAND_ID_PREFIX)
          || typeof instruction !== "string"
          || !instruction.trim()
        ) return "conflict";
        const commands = resumeData.steerCommands;
        next = commands.some((candidate) => candidate.id === commandId)
          ? resumeData
          : { ...resumeData, steerCommands: [...commands, { id: commandId, instruction }] };
        await transaction.insert(runCommands).values({ userId: run.userId, projectId: run.projectId, runId: run.id, commandId, instruction }).onConflictDoNothing();
      } else {
        const desiredState = command === "pause" ? "paused" : command === "abort" ? "cancelled" : "running";
        next = resumeData.desiredState === desiredState ? resumeData : { ...resumeData, desiredState };
      }
      const now = new Date();
      if (command === "resume") await transaction.update(tasks).set({ status: "queued", leaseOwner: null, leaseExpiresAt: null, scheduledAt: now, updatedAt: now }).where(and(eq(tasks.runId, run.id), eq(tasks.status, "paused")));
      if (command === "pause") await transaction.update(tasks).set({ status: "paused", updatedAt: now }).where(and(eq(tasks.runId, run.id), eq(tasks.status, "queued")));
      if (command === "abort") await transaction.update(tasks).set({ status: "cancelled", leaseOwner: null, leaseExpiresAt: null, updatedAt: now }).where(and(eq(tasks.runId, run.id), inArray(tasks.status, ["queued", "paused"])));
      if (next === resumeData && !normalizationChanged) return run;
      const [updated] = await transaction.update(runs).set({ resumeData: next, updatedAt: new Date() })
        .where(eq(runs.id, run.id)).returning();
      if (!updated) throw new Error("Run update returned no row");
      return updated;
    });
  }
}
