import { and, asc, eq, gt, isNotNull, ne } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { runEvents, runs } from "../db/schema/index.js";
import { appendRunEvent } from "./append.js";

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
    return appendRunEvent(this.database, scope, event);
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
        isNotNull(runEvents.stableId),
        ne(runEvents.type, "stream_delta"),
      ))
      .orderBy(asc(runEvents.sequence))
      .limit(limit);
  }
}
