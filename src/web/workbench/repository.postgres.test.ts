import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../../db/client.js";
import { migrateDatabase } from "../../db/migrate.js";
import { chapters, checkpoints, projects, runEvents, runs, tasks, usageRecords, users } from "../../db/schema/index.js";
import type { RequestAuth } from "../auth/plugin.js";
import { WorkbenchRepository } from "./repository.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const postgres = testDatabaseUrl ? describe : describe.skip;

postgres("PostgreSQL workbench projection", () => {
  let database: Database;
  let alice: RequestAuth;
  let bob: RequestAuth;

  beforeAll(async () => {
    await migrateDatabase(testDatabaseUrl!);
    database = createDatabase(testDatabaseUrl!);
    const [aliceRow, bobRow] = await database.insert(users).values([
      { username: `workbench-alice-${randomUUID()}`, passwordHash: "test" },
      { username: `workbench-bob-${randomUUID()}`, passwordHash: "test" },
    ]).returning();
    alice = { userId: aliceRow!.id, role: "user", sessionId: randomUUID() };
    bob = { userId: bobRow!.id, role: "user", sessionId: randomUUID() };
  });

  afterAll(async () => { await database.$client.end(); });

  it("projects latest chapter versions, task/checkpoint Agent state, and aggregated usage within one tenant", async () => {
    const [project] = await database.insert(projects).values({ userId: alice.userId, title: "Projection" }).returning();
    const [run] = await database.insert(runs).values({ userId: alice.userId, projectId: project!.id, status: "running" }).returning();
    const [task] = await database.insert(tasks).values({ userId: alice.userId, projectId: project!.id, runId: run!.id, type: "write", status: "running" }).returning();
    await database.insert(chapters).values([
      { userId: alice.userId, projectId: project!.id, runId: run!.id, sequence: 1, title: "Old", body: "old", version: 1 },
      { userId: alice.userId, projectId: project!.id, runId: run!.id, sequence: 1, title: "New", body: "new", version: 2 },
    ]);
    const [checkpoint] = await database.insert(checkpoints).values({ userId: alice.userId, projectId: project!.id, runId: run!.id, version: 3, state: { agents: [{ name: "Reviewer", state: "waiting" }] }, taskFingerprint: "fp", projectVersion: 1 }).returning();
    await database.update(runs).set({ latestCheckpointId: checkpoint!.id }).where(eq(runs.id, run!.id));
    await database.insert(runEvents).values({ userId: alice.userId, projectId: project!.id, runId: run!.id, sequence: 1, stableId: "writer-1", type: "system", payload: { type: "system", agent: "Writer", message: "drafting" } });
    await database.insert(usageRecords).values([
      { userId: alice.userId, projectId: project!.id, runId: run!.id, snapshotId: "u1", agent: "Writer", credentialSource: "user", provider: "openai", model: "gpt", inputTokens: 10, outputTokens: 5, cost: "0.01000000", latencyMs: 10 },
      { userId: alice.userId, projectId: project!.id, runId: run!.id, snapshotId: "u2", agent: "Writer", credentialSource: "user", provider: "openai", model: "gpt", inputTokens: 20, outputTokens: 7, cost: "0.02000000", latencyMs: 10 },
    ]);

    const repository = new WorkbenchRepository(database);
    const result = await repository.get(alice, project!.id);

    expect(result?.chapters).toEqual([expect.objectContaining({ title: "New", body: "new", version: 2 })]);
    expect(result?.latestRun).toMatchObject({ id: run!.id, version: 3, task: { id: task!.id, status: "running" }, checkpointVersion: 3 });
    expect(result?.agents).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Writer", summary: "drafting" }), expect.objectContaining({ name: "Reviewer", state: "waiting" })]));
    expect(result?.usage).toMatchObject({ inputTokens: 30, outputTokens: 12, totalTokens: 42, cost: "0.03000000" });
    expect(await repository.get(bob, project!.id)).toBeNull();
  });

  it("returns explicit empty states for a project without runs", async () => {
    const [project] = await database.insert(projects).values({ userId: alice.userId, title: "Empty" }).returning();
    await expect(new WorkbenchRepository(database).get(alice, project!.id)).resolves.toMatchObject({ chapters: [], latestRun: null, agents: [], pendingQuestion: null });
  });
});
