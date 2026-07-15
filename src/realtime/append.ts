import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { runEvents, runs } from "../db/schema/index.js";
import type { NewRunEvent, RunEvent, RunEventScope } from "./eventRepository.js";

type SequencedRunEvent = Omit<NewRunEvent, "payload"> & { payload: unknown | ((sequence: number) => unknown) };

export function appendRunEvent(database: Database, scope: RunEventScope, event: SequencedRunEvent): Promise<RunEvent> {
  return database.transaction((transaction) => appendRunEventInTransaction(transaction as unknown as Database, scope, event));
}

export async function appendRunEventInTransaction(database: Database, scope: RunEventScope, event: SequencedRunEvent): Promise<RunEvent> {
  const [ownedRun] = await database
    .select({ id: runs.id })
    .from(runs)
    .where(and(eq(runs.id, scope.runId), eq(runs.projectId, scope.projectId), eq(runs.userId, scope.userId)))
    .for("update")
    .limit(1);
  if (!ownedRun) throw new Error("Run not found");
  if (event.stableId) {
    const [existing] = await database
      .select()
      .from(runEvents)
      .where(and(eq(runEvents.runId, scope.runId), eq(runEvents.stableId, event.stableId)))
      .limit(1);
    if (existing) return existing;
  }
  const [latest] = await database
    .select({ sequence: sql<number>`coalesce(max(${runEvents.sequence}), 0)` })
    .from(runEvents)
    .where(and(eq(runEvents.runId, scope.runId), eq(runEvents.projectId, scope.projectId), eq(runEvents.userId, scope.userId)));
  const sequence = Number(latest?.sequence ?? 0) + 1;
  const payload = typeof event.payload === "function" ? event.payload(sequence) : event.payload;
  const [inserted] = await database
    .insert(runEvents)
    .values({ ...scope, ...event, payload, sequence })
    .returning();
  if (!inserted) throw new Error("Run event insert returned no row");
  return inserted;
}
