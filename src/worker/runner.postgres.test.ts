import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase, type Database } from "../db/client.js";
import { migrateDatabase } from "../db/migrate.js";
import { chapters, checkpoints, projects, runEvents, runs, tasks, usageRecords, users } from "../db/schema/index.js";
import { Host, type RuntimeAgent } from "../runtime/host.js";
import { SchedulerRepository } from "../scheduler/repository.js";
import { DatabaseStore } from "../store/database/index.js";
import { WorkerRunner, taskFingerprint, type ClaimedTask } from "./runner.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("PostgreSQL worker crash recovery", () => {
  let database: Database;

  beforeAll(async () => {
    await migrateDatabase(databaseUrl!);
    database = createDatabase(databaseUrl!);
  });

  afterAll(async () => {
    await database.$client.end();
  });

  it("reclaims an expired checkpointed run and preserves durable uniqueness", async () => {
    const userId = randomUUID();
    const projectId = randomUUID();
    const runId = randomUUID();
    await database.insert(users).values({ id: userId, username: userId, passwordHash: "test", concurrencyLimit: 2 });
    const [project] = await database.insert(projects).values({ id: projectId, userId, title: "crash recovery", version: 8 }).returning();
    await database.insert(runs).values({ id: runId, userId, projectId, resumeData: { desiredState: "running", steerCommands: [] } });
    const [inserted] = await database.insert(tasks).values({ userId, projectId, runId, type: "write", status: "running", priority: 2_000_000_000, leaseOwner: "dead-worker", leaseVersion: 1, leaseExpiresAt: new Date(Date.now() + 30_000), attempts: 1, payload: { prompt: "Write chapter two" } }).returning();
    const expiredTask = { ...inserted!, projectVersion: project!.version } satisfies ClaimedTask;
    const fingerprint = taskFingerprint(expiredTask);
    const deadStore = new DatabaseStore(database, { userId, projectId, runId, taskFingerprint: fingerprint, projectVersion: project!.version, lease: { taskId: inserted!.id, owner: "dead-worker", version: 1 } });
    await deadStore.progress.save({ novel_name: "Recovered Book", phase: "writing", current_chapter: 2, total_chapters: 3, completed_chapters: [1], total_word_count: 100 });
    await deadStore.runMeta.save({ started_at: "now", provider: "mock", style: "", model: "mock", planning_tier: "mid", steer_history: [], pending_steer: "", pause_point: null });
    await deadStore.drafts.saveFinalChapter(1, "chapter one");
    await deadStore.checkpoints.append({ kind: "global" }, "chapter-one", "chapters/01.md", fingerprint);
    const usage = { schema: 1 as const, updated_at: "before-crash", overall: { input: 10, output: 20, cache_read: 0, cache_write: 0, cost_usd: 0.5, saved_usd: 0, cache_capable: false }, per_agent: {}, missing_assistant_usage: 0 };
    await deadStore.usage.save(usage);
    const lifecycleId = `lifecycle:${deadStore.dir}:start`;
    await deadStore.runtime.appendQueue({ seq: 0, time: "", kind: "ui_event", priority: "background", category: "SYSTEM", summary: "启动创作", payload: { id: lifecycleId, type: "system", message: "启动创作", payload: { level: "info" } } });
    await database.update(tasks).set({ leaseExpiresAt: new Date(Date.now() - 1_000) }).where(eq(tasks.id, inserted!.id));

    const scheduler = new SchedulerRepository(database, { platformConcurrency: 100_000 });
    const prompts: string[] = [];
    let resumeCalls = 0;
    const runner = new WorkerRunner({
      scheduler,
      workerId: "recovery-worker",
      leaseMs: 30_000,
      createHost: async (claimed) => {
        const store = new DatabaseStore(database, { userId, projectId, runId, taskFingerprint: taskFingerprint(claimed), projectVersion: claimed.projectVersion, lease: { taskId: claimed.id, owner: "recovery-worker", version: claimed.leaseVersion } });
        const agent: RuntimeAgent = { run: async function* (prompt) { prompts.push(prompt); }, abort: vi.fn(), close: vi.fn() };
        const host = await Host.new({ provider: "mock", model: "mock", providers: { mock: { api_key: "test" } }, roles: {} }, {}, { agent, store });
        const resume = host.resume.bind(host);
        vi.spyOn(host, "resume").mockImplementation(async (signal) => { resumeCalls += 1; return resume(signal); });
        return host;
      },
    });

    await runner.runOnce();

    expect(resumeCalls).toBe(1);
    expect(prompts[0]).toContain("Recovered Book");
    expect((await database.select().from(tasks).where(eq(tasks.id, inserted!.id)))[0]?.status).toBe("completed");
    expect(await database.select().from(chapters).where(eq(chapters.runId, runId))).toHaveLength(1);
    expect(await database.select().from(checkpoints).where(eq(checkpoints.runId, runId))).toHaveLength(1);
    expect(await database.select().from(usageRecords).where(eq(usageRecords.runId, runId))).toHaveLength(1);
    expect((await database.select().from(runEvents).where(eq(runEvents.runId, runId))).filter((event) => event.stableId === lifecycleId)).toHaveLength(1);
  });
});
