import { randomUUID } from "node:crypto";
import { count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDatabase, type Database } from "../db/client.js";
import { migrateDatabase } from "../db/migrate.js";
import { projects, runEvents, runs, users } from "../db/schema/index.js";
import { PostgresEventBroker } from "./broker.js";
import { DatabaseEventRepository, type RunEventScope } from "./eventRepository.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("PostgreSQL resumable event stream", () => {
  let writer: Database;
  let reader: Database;

  beforeAll(async () => {
    await migrateDatabase(databaseUrl!);
    writer = createDatabase(databaseUrl!);
    reader = createDatabase(databaseUrl!);
  });

  afterAll(async () => {
    await Promise.all([writer.$client.end(), reader.$client.end()]);
  });

  async function createScope(): Promise<RunEventScope> {
    const userId = randomUUID();
    const projectId = randomUUID();
    const runId = randomUUID();
    await writer.insert(users).values({ id: userId, username: userId, passwordHash: "test" });
    await writer.insert(projects).values({ id: projectId, userId, title: "realtime" });
    await writer.insert(runs).values({ id: runId, userId, projectId });
    return { userId, projectId, runId };
  }

  it("allocates monotonic sequences under concurrent append and deduplicates stable IDs", async () => {
    const scope = await createScope();
    const repository = new DatabaseEventRepository(writer);
    const appended = await Promise.all(Array.from({ length: 20 }, (_, index) => repository.appendEvent(scope, {
      stableId: `concurrent-${index}`,
      type: "system",
      payload: { index },
    })));
    expect(appended.map(({ sequence }) => sequence).sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));

    const first = await repository.appendEvent(scope, { stableId: "retry-stable", type: "stream.delta", payload: { chunkSequence: 1 } });
    const retry = await repository.appendEvent(scope, { stableId: "retry-stable", type: "stream.delta", payload: { chunkSequence: 1 } });
    expect(retry.id).toBe(first.id);
    const [matches] = await writer.select({ value: count() }).from(runEvents).where(eq(runEvents.stableId, "retry-stable"));
    expect(matches?.value).toBe(1);
  });

  it("delivers LISTEN/NOTIFY across independent clients and pulls committed DB rows after notify", async () => {
    const scope = await createScope();
    const writerRepository = new DatabaseEventRepository(writer);
    const readerRepository = new DatabaseEventRepository(reader);
    const listenerBroker = new PostgresEventBroker(reader);
    const publisherBroker = new PostgresEventBroker(writer);
    let cursor = 0;
    const received: number[] = [];
    let resolveDelivered!: () => void;
    let rejectDelivered!: (error: Error) => void;
    const delivered = new Promise<void>((resolve, reject) => { resolveDelivered = resolve; rejectDelivered = reject; });
    await listenerBroker.subscribe(async (wakeup) => {
        if (wakeup.runId && wakeup.runId !== scope.runId) return;
        const events = await readerRepository.listAfter(scope, cursor, 500);
        for (const event of events) {
          cursor = event.sequence;
          received.push(event.sequence);
        }
        if (received.length) resolveDelivered();
      }, rejectDelivered);
    const event = await writerRepository.appendEvent(scope, { stableId: "cross-client", type: "system", payload: {} });
    await publisherBroker.publish({ runId: scope.runId, sequence: event.sequence });
    await delivered;

    expect(received).toEqual([event.sequence]);
    await Promise.all([listenerBroker.close(), publisherBroker.close()]);
  });

  it("commits before publish and leaves the row recoverable when notify fails", async () => {
    const scope = await createScope();
    const repository = new DatabaseEventRepository(writer);
    const publish = vi.fn(async ({ sequence }: { sequence: number }) => {
      const rows = await reader.select().from(runEvents).where(eq(runEvents.runId, scope.runId));
      expect(rows.some((event) => event.sequence === sequence)).toBe(true);
      throw new Error("notify failed");
    });
    const event = await repository.appendEvent(scope, { stableId: "notify-window", type: "system", payload: {} });

    await expect(publish({ sequence: event.sequence })).rejects.toThrow("notify failed");
    await expect(repository.listAfter(scope, 0, 500)).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ stableId: "notify-window" })]));
  });
});
