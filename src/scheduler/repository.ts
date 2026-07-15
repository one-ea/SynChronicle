import { and, asc, count, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { projects, runs, tasks, users } from "../db/schema/index.js";
import type { RequestAuth } from "../web/auth/plugin.js";
import type {
  EnqueueRunInput,
  ReleaseLeaseOutcome,
  RunCommand,
  RunCommandResult,
  RunResumeData,
  RunRow,
  TaskRow,
} from "./types.js";

const activeTaskStatuses = ["leased", "running"] as const;
const terminalRunStatuses = ["completed", "failed", "cancelled"] as const;
const schedulerAdvisoryLock = 0x53594e43;

export interface SchedulerRepositoryOptions {
  platformConcurrency: number;
}

export class SchedulerRepository {
  private readonly platformConcurrency: number;

  constructor(private readonly db: Database, options: SchedulerRepositoryOptions = { platformConcurrency: 4 }) {
    if (!Number.isInteger(options.platformConcurrency) || options.platformConcurrency <= 0) {
      throw new Error("platformConcurrency must be a positive integer");
    }
    this.platformConcurrency = options.platformConcurrency;
  }

  async enqueueRun(auth: RequestAuth, projectId: string, input: EnqueueRunInput = {}): Promise<RunRow | null> {
    return this.db.transaction(async (transaction) => {
      const [project] = await transaction.select({ id: projects.id }).from(projects).where(and(
        eq(projects.id, projectId),
        eq(projects.userId, auth.userId),
        eq(projects.status, "active"),
      )).limit(1).for("update");
      if (!project) return null;

      const [run] = await transaction.insert(runs).values({
        userId: auth.userId,
        projectId,
        budgetSnapshot: input.budgetSnapshot ?? {},
        resumeData: { desiredState: "running" } satisfies RunResumeData,
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

  async claimNextTask(workerId: string, leaseMs: number): Promise<TaskRow | null> {
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

      const candidates = await transaction.select({ task: tasks, userLimit: users.concurrencyLimit })
        .from(tasks)
        .innerJoin(users, eq(tasks.userId, users.id))
        .innerJoin(runs, and(
          eq(tasks.runId, runs.id),
          eq(tasks.userId, runs.userId),
          eq(tasks.projectId, runs.projectId),
        ))
        .where(and(
          eq(tasks.status, "queued"),
          lte(tasks.scheduledAt, now),
          eq(users.status, "active"),
          or(isNull(runs.resumeData), sql`${runs.resumeData}->>'desiredState' = 'running'`),
        ))
        .orderBy(sql`${tasks.priority} desc`, asc(tasks.createdAt))
        .limit(100)
        .for("update", { skipLocked: true });

      for (const { task, userLimit } of candidates) {
        const [{ value: userActive = 0 } = {}] = await transaction
          .select({ value: count() })
          .from(tasks)
          .where(and(eq(tasks.userId, task.userId), inArray(tasks.status, activeTaskStatuses)));
        if (userActive >= userLimit) continue;

        if (task.type === "write") {
          const [{ value: projectWrites = 0 } = {}] = await transaction
            .select({ value: count() })
            .from(tasks)
            .where(and(
              eq(tasks.projectId, task.projectId),
              eq(tasks.type, "write"),
              inArray(tasks.status, activeTaskStatuses),
            ));
          if (projectWrites > 0) continue;
        }

        const [claimed] = await transaction.update(tasks).set({
          status: "leased",
          leaseOwner: workerId,
          leaseExpiresAt: new Date(now.getTime() + leaseMs),
          attempts: sql`${tasks.attempts} + 1`,
          updatedAt: now,
        }).where(and(eq(tasks.id, task.id), eq(tasks.status, "queued"))).returning();
        if (claimed) return claimed;
      }
      return null;
    });
  }

  async renewLease(taskId: string, workerId: string, leaseMs: number): Promise<boolean> {
    if (!Number.isInteger(leaseMs) || leaseMs <= 0) throw new Error("leaseMs must be a positive integer");
    const now = new Date();
    const [renewed] = await this.db.update(tasks).set({
      leaseExpiresAt: new Date(now.getTime() + leaseMs),
      updatedAt: now,
    }).where(and(
      eq(tasks.id, taskId),
      eq(tasks.leaseOwner, workerId),
      inArray(tasks.status, activeTaskStatuses),
      sql`${tasks.leaseExpiresAt} > ${now}`,
    )).returning({ id: tasks.id });
    return Boolean(renewed);
  }

  async releaseLease(taskId: string, workerId: string, outcome: ReleaseLeaseOutcome): Promise<boolean> {
    const now = new Date();
    const [released] = await this.db.update(tasks).set({
      status: outcome.status,
      scheduledAt: outcome.scheduledAt ?? now,
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: now,
    }).where(and(
      eq(tasks.id, taskId),
      eq(tasks.leaseOwner, workerId),
      inArray(tasks.status, activeTaskStatuses),
    )).returning({ id: tasks.id });
    return Boolean(released);
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

      const resumeData = (run.resumeData && typeof run.resumeData === "object" ? run.resumeData : {}) as RunResumeData;
      if (resumeData.desiredState === "cancelled" && command !== "abort") return "conflict";
      let next: RunResumeData;
      if (command === "steer") {
        if (typeof payload !== "string" || !payload.trim()) return "conflict";
        const commands = resumeData.steerCommands ?? [];
        next = commands.at(-1) === payload ? resumeData : { ...resumeData, steerCommands: [...commands, payload] };
      } else {
        const desiredState = command === "pause" ? "paused" : command === "abort" ? "cancelled" : "running";
        next = resumeData.desiredState === desiredState ? resumeData : { ...resumeData, desiredState };
      }
      if (next === resumeData) return run;
      const [updated] = await transaction.update(runs).set({ resumeData: next, updatedAt: new Date() })
        .where(eq(runs.id, run.id)).returning();
      if (!updated) throw new Error("Run update returned no row");
      return updated;
    });
  }
}
