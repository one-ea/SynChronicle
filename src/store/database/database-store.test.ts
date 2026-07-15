import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabase } from "../../db/client.js";
import { migrateDatabase } from "../../db/migrate.js";
import { and, eq } from "drizzle-orm";
import { artifacts, chapters, checkpoints, projects, runEvents, runs, tasks, usageRecords, users } from "../../db/schema/index.js";
import { storeContract } from "../store.contract.js";
import { SchedulerRepository } from "../../scheduler/repository.js";
import { DatabaseStore, DrizzleDatabaseBackend, createMemoryDatabaseStore, type DatabaseBackend, type DatabaseStoreScope } from "./index.js";

const scope = () => ({ userId: randomUUID(), projectId: randomUUID(), runId: randomUUID() });

describe("DatabaseStore memory contract", () => {
  storeContract(async () => createMemoryDatabaseStore(scope()));

  it("enforces user, project, and run scope", async () => {
    const owner = scope();
    const first = createMemoryDatabaseStore(owner);
    const otherUser = createMemoryDatabaseStore({ ...owner, userId: randomUUID() }, first.backend);
    const otherProject = createMemoryDatabaseStore({ ...owner, projectId: randomUUID() }, first.backend);
    const otherRun = createMemoryDatabaseStore({ ...owner, runId: randomUUID() }, first.backend);
    await first.outline.savePremise("private");
    await first.runtime.appendQueue({ seq: 0, time: "", kind: "ui_event", priority: "background", summary: "private" });

    expect(await otherUser.outline.loadPremise()).toBe("");
    expect(await otherProject.outline.loadPremise()).toBe("");
    expect(await otherRun.runtime.loadQueue()).toEqual([]);
  });

  it("maps runtime, checkpoints, and usage to domain tables", async () => {
    const store = createMemoryDatabaseStore({ ...scope(), taskFingerprint: "task-fingerprint" });
    await store.runtime.appendQueue({ seq: 0, time: "", kind: "ui_event", priority: "background", summary: "event" });
    await store.checkpoints.append({ kind: "global" }, "checkpoint");
    const usage = { schema: 1 as const, updated_at: "now", overall: { input: 1, output: 2, cache_read: 0, cache_write: 0, cost_usd: 0, saved_usd: 0, cache_capable: false }, per_agent: {}, missing_assistant_usage: 0 };
    await store.usage.save(usage);
    await store.usage.save({ ...usage, updated_at: "later" });
    expect(store.backend.inspect("run_events")).toHaveLength(1);
    expect(store.backend.inspect("checkpoints")).toHaveLength(1);
    expect(store.backend.inspect("usage_records")).toHaveLength(1);
    expect(await store.latestCheckpoint()).toEqual({ taskFingerprint: "task-fingerprint", projectVersion: 1 });
  });

  it("commits selected candidate artifacts atomically", async () => {
    const store = createMemoryDatabaseStore(scope());
    const transaction = store.recordingTransaction();
    await transaction.store.drafts.saveFinalChapter(1, "selected");
    await transaction.store.usage.save({ schema: 1, updated_at: "now", overall: { input: 1, output: 1, cache_read: 0, cache_write: 0, cost_usd: 0, saved_usd: 0, cache_capable: false }, per_agent: {}, missing_assistant_usage: 0 });
    await transaction.store.checkpoints.append({ kind: "chapter", chapter: 1 }, "commit", "chapters/01.md", "sha256:selected");
    const staging = await store.staging.createSession("atomic");
    const ids = await transaction.stage(staging, 1);
    await staging.saveState({ phase: "committing", completion: { type: "reflection.completed", rounds: 2, score: 90, passed: true } });

    await store.commitStaged(staging, ids);

    expect(await store.drafts.loadChapterText(1)).toBe("selected");
    expect((await store.checkpoints.latestGlobal())?.step).toBe("commit");
    expect((await store.usage.load())?.overall.output).toBe(1);
    expect((await store.runtime.loadQueue()).at(-1)?.payload).toMatchObject({ type: "reflection.completed", rounds: 2 });
  });

  it("rolls back every selected artifact when a constraint fails", async () => {
    const store = createMemoryDatabaseStore(scope());
    const transaction = store.recordingTransaction();
    await transaction.store.outline.savePremise("candidate");
    await transaction.store.writeArtifact("invalid/constraint.json", { failConstraint: true });
    const staging = await store.staging.createSession("rollback");
    const ids = await transaction.stage(staging, 1);

    await expect(store.commitStaged(staging, ids)).rejects.toThrow("constraint");

    expect(await store.outline.loadPremise()).toBe("");
  });

  it("fences all durable writes with the active lease version", async () => {
    const owner = { ...scope(), taskFingerprint: "task", projectVersion: 7, lease: { taskId: randomUUID(), owner: "worker-a", version: 2 } };
    const store = createMemoryDatabaseStore(owner);
    store.backend.setLease(owner.lease);
    await store.drafts.saveFinalChapter(1, "owned");
    store.backend.setLease({ ...owner.lease, owner: "worker-b", version: 3 });

    await expect(store.drafts.saveFinalChapter(2, "stale")).rejects.toThrow("lease ownership lost");
    await expect(store.checkpoints.append({ kind: "global" }, "stale")).rejects.toThrow("lease ownership lost");
    await expect(store.runtime.appendQueue({ seq: 0, time: "", kind: "ui_event", priority: "control", summary: "stale" })).rejects.toThrow("lease ownership lost");
    expect(await store.drafts.loadChapterText(2)).toBe("");
  });

  it("stores the real project version with recovery checkpoints", async () => {
    const owner = { ...scope(), taskFingerprint: "task", projectVersion: 9 };
    const store = createMemoryDatabaseStore(owner);
    await store.checkpoints.append({ kind: "global" }, "checkpoint");

    await expect(store.latestCheckpoint()).resolves.toEqual({ taskFingerprint: "task", projectVersion: 9 });
  });

  it("applies a durable steer command once across a crash window", async () => {
    const owner = { ...scope(), lease: { taskId: randomUUID(), owner: "worker-a", version: 1 } };
    const store = createMemoryDatabaseStore(owner);
    store.backend.setLease(owner.lease);
    const fallback = { started_at: "now", provider: "test", style: "", model: "test", planning_tier: "mid" as const, steer_history: [], pending_steer: "", pause_point: null };

    await expect(store.applySteerCommand("steer-1", "Raise tension", fallback)).resolves.toBe(true);
    await expect(store.applySteerCommand("steer-1", "Raise tension", fallback)).resolves.toBe(false);
    expect(await store.runMeta.load()).toMatchObject({ pending_steer: "Raise tension", steer_history: [{ input: "Raise tension" }] });
  });
});

const databaseUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)("DatabaseStore PostgreSQL contract", () => {
  const database = databaseUrl ? createDatabase(databaseUrl) : null;
  afterAll(async () => { await database?.$client.end(); });

  storeContract(async () => {
    if (!databaseUrl || !database) throw new Error("TEST_DATABASE_URL is required");
    const owner = scope();
    await migrateDatabase(databaseUrl);
    await database.insert(users).values({ id: owner.userId, username: owner.userId, passwordHash: "test" }).onConflictDoNothing();
    await database.insert(projects).values({ id: owner.projectId, userId: owner.userId, title: "contract" }).onConflictDoNothing();
    await database.insert(runs).values({ id: owner.runId, userId: owner.userId, projectId: owner.projectId }).onConflictDoNothing();
    return new DatabaseStore(database, owner);
  });

  it("constructs scoped artifact SQL", () => {
    if (!database) return;
    const owner = scope();
    const query = database.select().from(artifacts).where(DatabaseStore.artifactScope(owner)).toSQL();
    expect(query.sql).toContain("user_id");
    expect(query.sql).toContain("project_id");
    expect(query.sql).toContain("run_id");
  });

  it("isolates runs and writes domain tables", async () => {
    if (!databaseUrl || !database) return;
    await migrateDatabase(databaseUrl);
    const owner = scope();
    const secondRunId = randomUUID();
    await database.insert(users).values({ id: owner.userId, username: owner.userId, passwordHash: "test" });
    await database.insert(projects).values({ id: owner.projectId, userId: owner.userId, title: "isolation" });
    await database.insert(runs).values([{ id: owner.runId, userId: owner.userId, projectId: owner.projectId }, { id: secondRunId, userId: owner.userId, projectId: owner.projectId }]);
    const first = new DatabaseStore(database, owner);
    const second = new DatabaseStore(database, { ...owner, runId: secondRunId });
    await first.outline.savePremise("first");
    await second.outline.savePremise("second");
    await first.drafts.saveFinalChapter(1, "version one");
    await first.drafts.saveFinalChapter(1, "version two");
    const firstAgain = new DatabaseStore(database, owner);
    await Promise.all([first.runtime.appendQueue({ seq: 0, time: "", kind: "ui_event", priority: "background", summary: "one" }), firstAgain.runtime.appendQueue({ seq: 0, time: "", kind: "ui_event", priority: "background", summary: "two" })]);
    await first.checkpoints.append({ kind: "global" }, "checkpoint");
    await first.usage.save({ schema: 1, updated_at: "now", overall: { input: 1, output: 2, cache_read: 0, cache_write: 0, cost_usd: 0, saved_usd: 0, cache_capable: false }, per_agent: {}, missing_assistant_usage: 0 });
    expect(await first.outline.loadPremise()).toBe("first");
    expect(await second.outline.loadPremise()).toBe("second");
    expect(await first.drafts.loadChapterText(1)).toBe("version two");
    expect((await first.runtime.loadQueue()).map((item) => item.seq)).toEqual([1, 2]);
    expect(await database.select().from(runEvents)).toEqual(expect.arrayContaining([expect.objectContaining({ runId: owner.runId })]));
    expect(await database.select().from(checkpoints)).toEqual(expect.arrayContaining([expect.objectContaining({ runId: owner.runId })]));
    expect(await database.select().from(usageRecords)).toEqual(expect.arrayContaining([expect.objectContaining({ runId: owner.runId })]));
  });

  it("keeps candidates invisible and rolls back a real constraint failure", async () => {
    if (!databaseUrl || !database) return;
    await migrateDatabase(databaseUrl);
    const owner = scope();
    await database.insert(users).values({ id: owner.userId, username: owner.userId, passwordHash: "test" });
    await database.insert(projects).values({ id: owner.projectId, userId: owner.userId, title: "rollback" });
    await database.insert(runs).values({ id: owner.runId, userId: owner.userId, projectId: owner.projectId });
    const store = new DatabaseStore(database, owner);
    const transaction = store.recordingTransaction();
    await transaction.store.outline.savePremise("candidate");
    await transaction.store.drafts.saveFinalChapter(0, "invalid");
    const staging = await store.staging.createSession(randomUUID());
    const ids = await transaction.stage(staging, 1);
    expect(await store.outline.loadPremise()).toBe("");
    await expect(store.commitStaged(staging, ids)).rejects.toThrow();
    expect(await store.outline.loadPremise()).toBe("");
    expect(await database.select().from(artifacts)).not.toEqual(expect.arrayContaining([expect.objectContaining({ runId: owner.runId, type: "premise.md" })]));
    expect(await database.select().from(chapters)).not.toEqual(expect.arrayContaining([expect.objectContaining({ runId: owner.runId, sequence: 0 })]));
  });

  it("rejects an old worker durable commit after lease reclaim", async () => {
    if (!databaseUrl || !database) return;
    await migrateDatabase(databaseUrl);
    const owner = scope();
    await database.insert(users).values({ id: owner.userId, username: owner.userId, passwordHash: "test" });
    const [project] = await database.insert(projects).values({ id: owner.projectId, userId: owner.userId, title: "fencing", version: 4 }).returning();
    await database.insert(runs).values({ id: owner.runId, userId: owner.userId, projectId: owner.projectId });
    const [task] = await database.insert(tasks).values({ ...owner, type: "write", status: "running", leaseOwner: "worker-a", leaseVersion: 1, leaseExpiresAt: new Date(Date.now() + 30_000) }).returning();
    const oldStore = new DatabaseStore(database, { ...owner, projectVersion: project!.version, taskFingerprint: "task", lease: { taskId: task!.id, owner: "worker-a", version: 1 } });
    const transaction = oldStore.recordingTransaction();
    await transaction.store.drafts.saveFinalChapter(1, "stale chapter");
    const staging = await oldStore.staging.createSession(randomUUID());
    const ids = await transaction.stage(staging, 1);
    await database.update(tasks).set({ leaseOwner: "worker-b", leaseVersion: 2, leaseExpiresAt: new Date(Date.now() + 30_000) }).where(eq(tasks.id, task!.id));

    await expect(oldStore.commitStaged(staging, ids)).rejects.toThrow("lease ownership lost");
    expect(await oldStore.drafts.loadChapterText(1)).toBe("");
  });

  it("blocks reclaim while an expired lease holder owns the durable transaction row lock", async () => {
    if (!databaseUrl || !database) return;
    await migrateDatabase(databaseUrl);
    const owner = scope();
    await database.insert(users).values({ id: owner.userId, username: owner.userId, passwordHash: "test", concurrencyLimit: 2 });
    const [project] = await database.insert(projects).values({ id: owner.projectId, userId: owner.userId, title: "transaction lock", version: 3 }).returning();
    await database.insert(runs).values({ id: owner.runId, userId: owner.userId, projectId: owner.projectId, resumeData: { desiredState: "running", steerCommands: [] } });
    const [task] = await database.insert(tasks).values({ ...owner, type: "write", status: "running", leaseOwner: "worker-a", leaseVersion: 1, leaseExpiresAt: new Date(Date.now() + 100) }).returning();
    let locked!: () => void;
    let release!: () => void;
    const lockReady = new Promise<void>((resolve) => { locked = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const inner = new DrizzleDatabaseBackend(database);
    const backend = new Proxy(inner, {
      get(target, property) {
        if (property === "transaction") return (storeScope: DatabaseStoreScope, operation: (value: DatabaseBackend) => Promise<unknown>) => target.transaction(storeScope, async (transaction) => { locked(); await gate; return operation(transaction); });
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as DatabaseBackend;
    const store = new DatabaseStore(database, { ...owner, projectVersion: project!.version, taskFingerprint: "task", lease: { taskId: task!.id, owner: "worker-a", version: 1 } }, backend);
    const recording = store.recordingTransaction();
    await recording.store.drafts.saveFinalChapter(1, "worker-a chapter");
    const staging = await store.staging.createSession(randomUUID());
    const ids = await recording.stage(staging, 1);
    const committing = store.commitStaged(staging, ids);
    await lockReady;
    await new Promise((resolve) => setTimeout(resolve, 120));
    const repository = new SchedulerRepository(database, { platformConcurrency: 100 });
    let reclaimed = false;
    const reclaiming = repository.claimNextTask("worker-b", 30_000).then((value) => { reclaimed = true; return value; });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(reclaimed).toBe(false);

    release();
    await committing;
    const claimed = await reclaiming;
    expect(claimed).toMatchObject({ id: task!.id, leaseOwner: "worker-b", leaseVersion: 2 });
    expect(await store.drafts.loadChapterText(1)).toBe("worker-a chapter");
  });

  it("upserts concurrent usage snapshots by stable billing content", async () => {
    if (!databaseUrl || !database) return;
    await migrateDatabase(databaseUrl);
    const owner = scope();
    await database.insert(users).values({ id: owner.userId, username: owner.userId, passwordHash: "test" });
    await database.insert(projects).values({ id: owner.projectId, userId: owner.userId, title: "usage" });
    await database.insert(runs).values({ id: owner.runId, userId: owner.userId, projectId: owner.projectId });
    const store = new DatabaseStore(database, owner);
    const base = { schema: 1 as const, overall: { input: 5, output: 7, cache_read: 0, cache_write: 0, cost_usd: 0.2, saved_usd: 0, cache_capable: false }, per_agent: {}, missing_assistant_usage: 0 };
    await Promise.all([store.usage.save({ ...base, updated_at: "first" }), store.usage.save({ ...base, updated_at: "second" })]);
    const rows = await database.select().from(usageRecords).where(and(eq(usageRecords.runId, owner.runId), eq(usageRecords.agent, "__store_state__")));
    expect(rows).toHaveLength(1);
  });
});
