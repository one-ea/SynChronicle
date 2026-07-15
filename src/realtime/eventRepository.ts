import { and, asc, eq, gt, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { runEvents, runs } from "../db/schema/index.js";

export interface RunEventScope {
  userId: string;
  projectId: string;
  runId: string;
}

export interface RunEvent extends RunEventScope {
  id: string;
  sequence: number;
  stableId: string | null;
  type: string;
  payload: unknown;
  createdAt: Date;
}

export interface NewRunEvent {
  stableId: string | null;
  type: string;
  payload: unknown;
}

export interface RunEventRepository {
  findScope(userId: string, runId: string): Promise<RunEventScope | undefined>;
  appendEvent(scope: RunEventScope, event: NewRunEvent): Promise<RunEvent>;
  listAfter(scope: RunEventScope, sequence: number, limit: number): Promise<RunEvent[]>;
}

export class DatabaseEventRepository implements RunEventRepository {
  constructor(private readonly database: Database) {}

  async findScope(userId: string, runId: string): Promise<RunEventScope | undefined> {
    const [scope] = await this.database
      .select({ userId: runs.userId, projectId: runs.projectId, runId: runs.id })
      .from(runs)
      .where(and(eq(runs.userId, userId), eq(runs.id, runId)))
      .limit(1);
    return scope;
  }

  async appendEvent(scope: RunEventScope, event: NewRunEvent): Promise<RunEvent> {
    return this.database.transaction(async (transaction) => {
      const [ownedRun] = await transaction
        .select({ id: runs.id })
        .from(runs)
        .where(and(eq(runs.id, scope.runId), eq(runs.projectId, scope.projectId), eq(runs.userId, scope.userId)))
        .for("update")
        .limit(1);
      if (!ownedRun) throw new Error("Run not found");
      if (event.stableId) {
        const [existing] = await transaction
          .select()
          .from(runEvents)
          .where(and(eq(runEvents.runId, scope.runId), eq(runEvents.stableId, event.stableId)))
          .limit(1);
        if (existing) return existing;
      }
      const [latest] = await transaction
        .select({ sequence: sql<number>`coalesce(max(${runEvents.sequence}), 0)` })
        .from(runEvents)
        .where(and(eq(runEvents.runId, scope.runId), eq(runEvents.projectId, scope.projectId), eq(runEvents.userId, scope.userId)));
      const [inserted] = await transaction
        .insert(runEvents)
        .values({ ...scope, ...event, sequence: Number(latest?.sequence ?? 0) + 1 })
        .returning();
      if (!inserted) throw new Error("Run event insert returned no row");
      return inserted;
    });
  }

  async listAfter(scope: RunEventScope, sequence: number, limit: number): Promise<RunEvent[]> {
    return this.database
      .select()
      .from(runEvents)
      .where(and(
        eq(runEvents.userId, scope.userId),
        eq(runEvents.projectId, scope.projectId),
        eq(runEvents.runId, scope.runId),
        gt(runEvents.sequence, sequence),
      ))
      .orderBy(asc(runEvents.sequence))
      .limit(limit);
  }
}
