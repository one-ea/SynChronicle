import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { count, eq, inArray } from "drizzle-orm";
import { createDatabase, type Database } from "../db/client.js";
import { migrateDatabase } from "../db/migrate.js";
import { projects, runCommands, runs, tasks, users } from "../db/schema/index.js";
import type { RequestAuth } from "../web/auth/plugin.js";
import { buildEligibleTaskQuery, buildReleaseLeaseQuery, normalizeRunResumeData, SchedulerRepository } from "./repository.js";
import { SchedulerService } from "./service.js";

describe("scheduler service", () => {
  it("rejects invalid lease durations before accessing storage", async () => {
    const repository = { claimNextTask: async () => null };
    const service = new SchedulerService(repository);

    expect(() => service.claimNextTask("worker-a", 0)).toThrow("leaseMs");
    expect(() => service.claimNextTask("", 30_000)).toThrow("workerId");
  });

  it("builds release SQL that requires a current owner and unexpired lease", async () => {
    const database = createDatabase("postgres://test:test@localhost/test");
    try {
      const query = buildReleaseLeaseQuery(database, "task-id", "worker-a", { status: "completed" }, new Date()).toSQL();
      expect(query.sql).toContain('"lease_owner" = $');
      expect(query.sql).toContain('"lease_expires_at" > $');
    } finally {
      await database.$client.end();
    }
  });

  it("selects one eligible candidate in SQL without a fixed candidate window", async () => {
    const database = createDatabase("postgres://test:test@localhost/test");
    try {
      const query = buildEligibleTaskQuery(database, new Date()).toSQL();
      expect(query.sql).toMatch(/limit \$\d+ for update skip locked/);
      expect(query.params.at(-1)).toBe(1);
      expect(query.sql).toContain("concurrency_limit");
      expect(query.sql).toContain("not exists");
      expect(query.sql).toContain("coalesce");
      expect(query.sql).toMatch(/desiredState.*not in \('paused', 'cancelled'\)/);
      expect(query.sql).toMatch(/"tasks"\."attempts" < "tasks"\."max_attempts"/);
      expect(query.params).not.toContain(100);
    } finally {
      await database.$client.end();
    }
  });

  it("normalizes legacy resume data deterministically while preserving other fields", () => {
    const legacy = {
      checkpoint: { chapter: 3 },
      steerCommands: [
        "Revise pacing",
        { commandId: "old-object", instruction: "Keep tone" },
        { id: "current", instruction: "Add detail" },
        null,
        { id: 42, instruction: "invalid" },
      ],
    };

    const first = normalizeRunResumeData(legacy);
    const second = normalizeRunResumeData(legacy);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      desiredState: "running",
      checkpoint: { chapter: 3 },
      steerCommands: [
        { id: expect.stringMatching(/^legacy:/), instruction: "Revise pacing" },
        { id: "old-object", instruction: "Keep tone" },
        { id: "current", instruction: "Add detail" },
      ],
    });
  });

  it("normalizes malformed resume data to safe runnable defaults", () => {
    expect(normalizeRunResumeData({ desiredState: 12, steerCommands: "broken", legacy: true })).toEqual({
      desiredState: "running",
      steerCommands: [],
      legacy: true,
    });
    expect(normalizeRunResumeData("broken")).toEqual({ desiredState: "running", steerCommands: [] });
  });

  it("keeps generated legacy IDs stable and preserves existing normalized IDs", () => {
    const generated = normalizeRunResumeData({ steerCommands: ["Legacy command"] });
    const repeated = normalizeRunResumeData({ steerCommands: ["Legacy command"] });
    const persisted = normalizeRunResumeData(generated);

    expect(generated.steerCommands[0]?.id).toMatch(/^legacy:/);
    expect(repeated).toEqual(generated);
    expect(persisted).toEqual(generated);
  });
});

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const postgres = testDatabaseUrl ? describe : describe.skip;

postgres("PostgreSQL leased scheduler", () => {
  let database: Database;
  let repository: SchedulerRepository;
  let auth: RequestAuth;
  let projectId: string;

  beforeAll(async () => {
    await migrateDatabase(testDatabaseUrl!);
    database = createDatabase(testDatabaseUrl!);
    repository = new SchedulerRepository(database, { platformConcurrency: 100_000 });
    const [user] = await database.insert(users).values({
      username: `scheduler-${randomUUID()}`,
      passwordHash: "test",
      concurrencyLimit: 1,
    }).returning();
    const [project] = await database.insert(projects).values({
      userId: user!.id,
      title: "Scheduler",
    }).returning();
    auth = { userId: user!.id, role: "user", sessionId: randomUUID() };
    projectId = project!.id;
  });

  afterAll(async () => {
    await database.$client.end();
  });

  async function settleTasks(userIds: string[]) {
    await database.update(tasks).set({ status: "cancelled", leaseOwner: null, leaseExpiresAt: null }).where(andUserIds(userIds));
  }

  function andUserIds(userIds: string[]) {
    return inArray(tasks.userId, userIds);
  }

  it("enqueues a tenant-owned run and task", async () => {
    const idempotencyKey = randomUUID();
    const [result, retry] = await Promise.all([
      repository.enqueueRun(auth, projectId, { idempotencyKey, type: "write", payload: { chapter: 1 } }),
      repository.enqueueRun(auth, projectId, { idempotencyKey, type: "write", payload: { chapter: 1 } }),
    ]);

    expect(result).not.toBeNull();
    expect(retry?.id).toBe(result!.id);
    expect(result).toMatchObject({ userId: auth.userId, projectId, status: "queued" });
    const stored = await database.select().from(tasks).where(eq(tasks.runId, result!.id));
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ type: "write", status: "queued", payload: { chapter: 1 } });
    await settleTasks([auth.userId]);
  });

  it("scopes start idempotency keys by tenant and project", async () => {
    const suffix = randomUUID();
    const [otherUser] = await database.insert(users).values({ username: `idempotency-${suffix}`, passwordHash: "test" }).returning();
    const [otherProject] = await database.insert(projects).values({ userId: otherUser!.id, title: "Other tenant" }).returning();
    const key = `shared-${suffix}`;
    const own = await repository.enqueueRun(auth, projectId, { idempotencyKey: key, type: "review" });
    const foreign = await repository.enqueueRun(
      { userId: otherUser!.id, role: "user", sessionId: randomUUID() },
      otherProject!.id,
      { idempotencyKey: key, type: "review" },
    );

    expect(foreign?.id).not.toBe(own?.id);
    await settleTasks([auth.userId, otherUser!.id]);
  });

  it("claims one task once and respects the user limit under concurrent claimants", async () => {
    const firstRun = await repository.enqueueRun(auth, projectId, { idempotencyKey: randomUUID(), type: "review" });
    expect(firstRun).not.toBeNull();
    const [secondProject] = await database.insert(projects).values({ userId: auth.userId, title: "Second" }).returning();
    await repository.enqueueRun(auth, secondProject!.id, { idempotencyKey: randomUUID(), type: "review" });

    const [first, second] = await Promise.all([
      repository.claimNextTask("worker-a", 30_000),
      repository.claimNextTask("worker-b", 30_000),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect([first?.runId, second?.runId]).toContain(firstRun!.id);
    await settleTasks([auth.userId]);
  });

  it("serializes concurrent claimants at the platform limit", async () => {
    const [{ value: baselineActive = 0 } = {}] = await database.select({ value: count() }).from(tasks).where(inArray(tasks.status, ["leased", "running"]));
    const limitedRepository = new SchedulerRepository(database, { platformConcurrency: baselineActive + 1 });
    const suffix = randomUUID();
    const createdUsers = await database.insert(users).values([
      { username: `platform-a-${suffix}`, passwordHash: "test", concurrencyLimit: 2 },
      { username: `platform-b-${suffix}`, passwordHash: "test", concurrencyLimit: 2 },
    ]).returning();
    const createdProjects = await database.insert(projects).values(createdUsers.map((user, index) => ({
      userId: user.id,
      title: `Platform ${index}`,
    }))).returning();
    for (let index = 0; index < createdUsers.length; index += 1) {
      await limitedRepository.enqueueRun(
        { userId: createdUsers[index]!.id, role: "user", sessionId: randomUUID() },
        createdProjects[index]!.id,
        { idempotencyKey: randomUUID(), type: "review", priority: 1_000_000 },
      );
    }

    const claims = await Promise.all([
      limitedRepository.claimNextTask("platform-worker-a", 30_000),
      limitedRepository.claimNextTask("platform-worker-b", 30_000),
    ]);

    expect(claims.filter(Boolean)).toHaveLength(1);
    await settleTasks(createdUsers.map((user) => user.id));
  });

  it("allows only one active write task for a project", async () => {
    const suffix = randomUUID();
    const [writer] = await database.insert(users).values({
      username: `project-write-${suffix}`,
      passwordHash: "test",
      concurrencyLimit: 3,
    }).returning();
    const [project] = await database.insert(projects).values({ userId: writer!.id, title: "Write limit" }).returning();
    const writerAuth = { userId: writer!.id, role: "user" as const, sessionId: randomUUID() };
    await repository.enqueueRun(writerAuth, project!.id, { idempotencyKey: randomUUID(), type: "write" });
    await repository.enqueueRun(writerAuth, project!.id, { idempotencyKey: randomUUID(), type: "write" });

    const first = await repository.claimNextTask("write-worker-a", 30_000);
    const second = await repository.claimNextTask("write-worker-b", 30_000);

    expect(first?.projectId).toBe(project!.id);
    expect(second?.projectId).not.toBe(project!.id);
    await settleTasks([writer!.id]);
  });

  it("renews, releases, and recovers an expired lease", async () => {
    await database.update(users).set({ concurrencyLimit: 2 }).where(eq(users.id, auth.userId));
    const [thirdProject] = await database.insert(projects).values({ userId: auth.userId, title: "Third" }).returning();
    const run = await repository.enqueueRun(auth, thirdProject!.id, { idempotencyKey: randomUUID(), type: "review" });
    expect(run).not.toBeNull();
    const claimed = await repository.claimNextTask("worker-c", 30_000);
    expect(claimed?.runId).toBe(run!.id);
    expect(await repository.renewLease(claimed!.id, "worker-c", 60_000)).toBe(true);
    expect(await repository.releaseLease(claimed!.id, "worker-c", { status: "completed" })).toBe(true);
    expect(await repository.releaseLease(claimed!.id, "worker-c", { status: "completed" })).toBe(false);

    const expiredRun = await repository.enqueueRun(auth, thirdProject!.id, { idempotencyKey: randomUUID(), type: "maintenance" });
    expect(expiredRun).not.toBeNull();
    const [expiredTask] = await database.select().from(tasks).where(eq(tasks.runId, expiredRun!.id));
    await database.update(tasks).set({
      status: "leased",
      leaseOwner: "dead-worker",
      leaseExpiresAt: new Date(Date.now() - 1_000),
    }).where(eq(tasks.id, expiredTask!.id));

    const recovered = await repository.claimNextTask("worker-d", 30_000);
    expect(recovered?.id).toBe(expiredTask!.id);
    expect(recovered?.leaseOwner).toBe("worker-d");
    await settleTasks([auth.userId]);
  });

  it("rejects wrong-owner and expired renew or release", async () => {
    const [project] = await database.insert(projects).values({ userId: auth.userId, title: `Lease ${randomUUID()}` }).returning();
    const run = await repository.enqueueRun(auth, project!.id, { idempotencyKey: randomUUID(), type: "review" });
    const claimed = await repository.claimNextTask("lease-owner", 30_000);
    expect(claimed?.runId).toBe(run!.id);
    expect(await repository.renewLease(claimed!.id, "wrong-owner", 30_000)).toBe(false);
    expect(await repository.releaseLease(claimed!.id, "wrong-owner", { status: "completed" })).toBe(false);
    await database.update(tasks).set({ leaseExpiresAt: new Date(Date.now() - 1_000) }).where(eq(tasks.id, claimed!.id));
    expect(await repository.renewLease(claimed!.id, "lease-owner", 30_000)).toBe(false);
    expect(await repository.releaseLease(claimed!.id, "lease-owner", { status: "completed" })).toBe(false);
    await settleTasks([auth.userId]);
  });

  it("serializes expired release against recovery and claim", async () => {
    const [project] = await database.insert(projects).values({ userId: auth.userId, title: `Race ${randomUUID()}` }).returning();
    const run = await repository.enqueueRun(auth, project!.id, { idempotencyKey: randomUUID(), type: "review" });
    const [task] = await database.select().from(tasks).where(eq(tasks.runId, run!.id));
    await database.update(tasks).set({
      status: "leased",
      leaseOwner: "expired-owner",
      leaseExpiresAt: new Date(Date.now() - 1_000),
      attempts: 1,
    }).where(eq(tasks.id, task!.id));

    const [released, claimed] = await Promise.all([
      repository.releaseLease(task!.id, "expired-owner", { status: "completed" }),
      repository.claimNextTask("recovery-worker", 30_000),
    ]);

    expect(released).toBe(false);
    expect(claimed?.id).toBe(task!.id);
    expect(claimed?.leaseOwner).toBe("recovery-worker");
    await settleTasks([auth.userId]);
  });

  it("fails expired running tasks at max attempts and recovers retryable running tasks", async () => {
    const [project] = await database.insert(projects).values({ userId: auth.userId, title: `Expiry ${randomUUID()}` }).returning();
    const failedRun = await repository.enqueueRun(auth, project!.id, { idempotencyKey: randomUUID(), type: "review" });
    const recoveredRun = await repository.enqueueRun(auth, project!.id, { idempotencyKey: randomUUID(), type: "maintenance" });
    const scopedTasks = await database.select().from(tasks).where(inArray(tasks.runId, [failedRun!.id, recoveredRun!.id]));
    const failedTask = scopedTasks.find((task) => task.runId === failedRun!.id)!;
    const retryableTask = scopedTasks.find((task) => task.runId === recoveredRun!.id)!;
    await database.update(tasks).set({ status: "running", leaseOwner: "dead", leaseExpiresAt: new Date(Date.now() - 1_000), attempts: 3, maxAttempts: 3 }).where(eq(tasks.id, failedTask.id));
    await database.update(tasks).set({ status: "running", leaseOwner: "dead", leaseExpiresAt: new Date(Date.now() - 1_000), attempts: 1, maxAttempts: 3 }).where(eq(tasks.id, retryableTask.id));

    const claimed = await repository.claimNextTask("expiry-worker", 30_000);
    const [failed] = await database.select().from(tasks).where(eq(tasks.id, failedTask.id));

    expect(failed?.status).toBe("failed");
    expect(claimed?.id).toBe(retryableTask.id);
    expect(claimed?.attempts).toBe(2);
    await settleTasks([auth.userId]);
  });

  it("reaches an eligible task beyond more than one hundred blocked candidates", async () => {
    const suffix = randomUUID();
    const [blockedUser, eligibleUser] = await database.insert(users).values([
      { username: `blocked-${suffix}`, passwordHash: "test", concurrencyLimit: 1 },
      { username: `eligible-${suffix}`, passwordHash: "test", concurrencyLimit: 1 },
    ]).returning();
    const [blockedProject, eligibleProject] = await database.insert(projects).values([
      { userId: blockedUser!.id, title: "Blocked" },
      { userId: eligibleUser!.id, title: "Eligible" },
    ]).returning();
    const blockedRuns = await database.insert(runs).values(Array.from({ length: 102 }, (_, index) => ({
      userId: blockedUser!.id,
      projectId: blockedProject!.id,
      idempotencyKey: `blocked-${suffix}-${index}`,
      resumeData: { desiredState: "running" },
    }))).returning();
    await database.insert(tasks).values(blockedRuns.map((run, index) => ({
      userId: blockedUser!.id,
      projectId: blockedProject!.id,
      runId: run.id,
      type: "review" as const,
      status: index === 0 ? "running" as const : "queued" as const,
      priority: 100,
      leaseOwner: index === 0 ? "busy-worker" : null,
      leaseExpiresAt: index === 0 ? new Date(Date.now() + 60_000) : null,
    })));
    const eligibleRun = await repository.enqueueRun(
      { userId: eligibleUser!.id, role: "user", sessionId: randomUUID() },
      eligibleProject!.id,
      { idempotencyKey: `eligible-${suffix}`, type: "review", priority: 0 },
    );

    const claimed = await new SchedulerRepository(database, { platformConcurrency: 10 }).claimNextTask("fair-worker", 30_000);

    expect(claimed?.runId).toBe(eligibleRun!.id);
    await settleTasks([blockedUser!.id, eligibleUser!.id]);
  });

  it("persists command state, isolates tenants, and deduplicates steer command IDs", async () => {
    const [project] = await database.insert(projects).values({ userId: auth.userId, title: `Commands ${randomUUID()}` }).returning();
    const run = await repository.enqueueRun(auth, project!.id, { idempotencyKey: randomUUID(), type: "review" });
    const foreignAuth = { userId: randomUUID(), role: "user" as const, sessionId: randomUUID() };

    expect(await repository.command(foreignAuth, project!.id, run!.id, "pause")).toBe("missing");
    const paused = await repository.command(auth, project!.id, run!.id, "pause");
    const pausedRetry = await repository.command(auth, project!.id, run!.id, "pause");
    expect(pausedRetry).toEqual(paused);
    await repository.command(auth, project!.id, run!.id, "resume");
    const firstSteer = await repository.command(auth, project!.id, run!.id, "steer", { commandId: "steer-1", instruction: "Revise" });
    const steerRetry = await repository.command(auth, project!.id, run!.id, "steer", { commandId: "steer-1", instruction: "Ignored retry text" });
    const secondSteer = await repository.command(auth, project!.id, run!.id, "steer", { commandId: "steer-2", instruction: "Revise" });

    expect(steerRetry).toEqual(firstSteer);
    if (typeof secondSteer === "string") throw new Error(`Unexpected command result: ${secondSteer}`);
    expect(secondSteer.resumeData).toMatchObject({
      desiredState: "running",
      steerCommands: [
        { id: "steer-1", instruction: "Revise" },
        { id: "steer-2", instruction: "Revise" },
      ],
    });
    const aborted = await repository.command(auth, project!.id, run!.id, "abort");
    expect(await repository.command(auth, project!.id, run!.id, "abort")).toEqual(aborted);
    expect(await repository.command(auth, project!.id, run!.id, "resume")).toBe("conflict");
    await settleTasks([auth.userId]);
  });

  it("claims historical null, empty, and legacy-field resume data while respecting pause and cancel", async () => {
    const suffix = randomUUID();
    const [legacyUser] = await database.insert(users).values({
      username: `legacy-eligible-${suffix}`,
      passwordHash: "test",
      concurrencyLimit: 10,
    }).returning();
    const [legacyProject] = await database.insert(projects).values({ userId: legacyUser!.id, title: "Legacy eligibility" }).returning();
    const states: unknown[] = [
      null,
      {},
      { checkpoint: { chapter: 2 } },
      { desiredState: 42 },
      { desiredState: ["paused"] },
      { desiredState: "future-state" },
      { desiredState: "paused" },
      { desiredState: "cancelled" },
    ];
    const legacyRuns = await database.insert(runs).values(states.map((resumeData, index) => ({
      userId: legacyUser!.id,
      projectId: legacyProject!.id,
      idempotencyKey: `legacy-state-${suffix}-${index}`,
      resumeData,
    }))).returning();
    await database.insert(tasks).values(legacyRuns.map((run) => ({
      userId: legacyUser!.id,
      projectId: legacyProject!.id,
      runId: run.id,
      type: "review" as const,
      priority: 2_000_000,
    })));

    const claimed = await Promise.all(Array.from(
      { length: 6 },
      (_, index) => repository.claimNextTask(`legacy-worker-${index + 1}`, 30_000),
    ));
    const claimedRunIds = new Set(claimed.map((task) => task?.runId));

    expect(claimedRunIds).toEqual(new Set(legacyRuns.slice(0, 6).map((run) => run.id)));
    expect(claimedRunIds.has(legacyRuns[6]!.id)).toBe(false);
    expect(claimedRunIds.has(legacyRuns[7]!.id)).toBe(false);
    await settleTasks([legacyUser!.id]);
  });

  it("normalizes historical command data through the real repository", async () => {
    const [project] = await database.insert(projects).values({ userId: auth.userId, title: `Legacy commands ${randomUUID()}` }).returning();
    const run = await repository.enqueueRun(auth, project!.id, { idempotencyKey: randomUUID(), type: "review" });
    const historical = {
      checkpoint: { chapter: 7 },
      steerCommands: ["Legacy direction", { commandId: "old-id", instruction: "Keep voice" }, { broken: true }],
    };
    await database.update(runs).set({ resumeData: historical }).where(eq(runs.id, run!.id));

    expect(await repository.command(auth, project!.id, run!.id, "steer", {
      commandId: "legacy:client-collision",
      instruction: "Must reject",
    })).toBe("conflict");
    const first = await repository.command(auth, project!.id, run!.id, "steer", { commandId: "new-id", instruction: "Add tension" });
    const retry = await repository.command(auth, project!.id, run!.id, "steer", { commandId: "new-id", instruction: "Ignored retry" });

    if (typeof first === "string" || typeof retry === "string") throw new Error("Unexpected command result");
    expect(retry).toEqual(first);
    expect(first.resumeData).toMatchObject({
      desiredState: "running",
      checkpoint: { chapter: 7 },
      steerCommands: [
        { id: expect.stringMatching(/^legacy:0:/), instruction: "Legacy direction" },
        { id: "old-id", instruction: "Keep voice" },
        { id: "new-id", instruction: "Add tension" },
      ],
    });
    await database.update(runs).set({ resumeData: { legacy: true, steerCommands: { broken: true } } }).where(eq(runs.id, run!.id));
    const normalized = await repository.command(auth, project!.id, run!.id, "pause");
    if (typeof normalized === "string") throw new Error(`Unexpected command result: ${normalized}`);
    expect(normalized.resumeData).toMatchObject({ legacy: true, desiredState: "paused", steerCommands: [] });
    await settleTasks([auth.userId]);
  });

  it("pauses and resumes the same task atomically and idempotently", async () => {
    const [project] = await database.insert(projects).values({ userId: auth.userId, title: `Pause resume ${randomUUID()}` }).returning();
    const run = await repository.enqueueRun(auth, project!.id, { idempotencyKey: randomUUID(), type: "review" });
    await repository.command(auth, project!.id, run!.id, "pause");
    await repository.command(auth, project!.id, run!.id, "pause");
    expect((await database.select().from(tasks).where(eq(tasks.runId, run!.id)))[0]?.status).toBe("paused");

    await repository.command(auth, project!.id, run!.id, "resume");
    await repository.command(auth, project!.id, run!.id, "resume");
    expect((await database.select().from(tasks).where(eq(tasks.runId, run!.id)))[0]).toMatchObject({ status: "queued", leaseOwner: null, leaseExpiresAt: null });
    await settleTasks([auth.userId]);
  });

  it("reclaims a steer claim after a worker crash and acknowledges once", async () => {
    const [project] = await database.insert(projects).values({ userId: auth.userId, title: `Steer recovery ${randomUUID()}` }).returning();
    const run = await repository.enqueueRun(auth, project!.id, { idempotencyKey: randomUUID(), type: "review", priority: 3_000_000 });
    await repository.command(auth, project!.id, run!.id, "steer", { commandId: "durable-steer", instruction: "Raise tension" });
    const first = await repository.claimNextTask("steer-worker-a", 30_000);
    expect(first?.runId).toBe(run!.id);
    expect(await repository.claimSteerCommands(first!.id, "steer-worker-a", first!.leaseVersion)).toEqual([{ id: "durable-steer", instruction: "Raise tension" }]);
    await database.update(tasks).set({ status: "queued", leaseOwner: null, leaseExpiresAt: null }).where(eq(tasks.id, first!.id));
    const second = await repository.claimNextTask("steer-worker-b", 30_000);
    expect(await repository.claimSteerCommands(second!.id, "steer-worker-b", second!.leaseVersion)).toEqual([{ id: "durable-steer", instruction: "Raise tension" }]);
    expect(await repository.acknowledgeSteerCommands(second!.id, "steer-worker-b", second!.leaseVersion, ["durable-steer"])).toBe(true);
    expect((await database.select().from(runCommands).where(eq(runCommands.runId, run!.id)))[0]?.status).toBe("applied");
    await settleTasks([auth.userId]);
  });
});
