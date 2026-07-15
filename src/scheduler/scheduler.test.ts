import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { createDatabase, type Database } from "../db/client.js";
import { migrateDatabase } from "../db/migrate.js";
import { projects, tasks, users } from "../db/schema/index.js";
import type { RequestAuth } from "../web/auth/plugin.js";
import { SchedulerRepository } from "./repository.js";
import { SchedulerService } from "./service.js";

describe("scheduler service", () => {
  it("rejects invalid lease durations before accessing storage", async () => {
    const repository = { claimNextTask: async () => null };
    const service = new SchedulerService(repository);

    expect(() => service.claimNextTask("worker-a", 0)).toThrow("leaseMs");
    expect(() => service.claimNextTask("", 30_000)).toThrow("workerId");
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
    repository = new SchedulerRepository(database, { platformConcurrency: 2 });
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
    const result = await repository.enqueueRun(auth, projectId, { type: "write", payload: { chapter: 1 } });

    expect(result).not.toBeNull();
    expect(result).toMatchObject({ userId: auth.userId, projectId, status: "queued" });
    const stored = await database.query.tasks.findFirst({ where: (task, { eq }) => eq(task.runId, result!.id) });
    expect(stored).toMatchObject({ type: "write", status: "queued", payload: { chapter: 1 } });
    await settleTasks([auth.userId]);
  });

  it("claims one task once and respects the user limit under concurrent claimants", async () => {
    const firstRun = await repository.enqueueRun(auth, projectId, { type: "review" });
    expect(firstRun).not.toBeNull();
    const [secondProject] = await database.insert(projects).values({ userId: auth.userId, title: "Second" }).returning();
    await repository.enqueueRun(auth, secondProject!.id, { type: "review" });

    const [first, second] = await Promise.all([
      repository.claimNextTask("worker-a", 30_000),
      repository.claimNextTask("worker-b", 30_000),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect([first?.runId, second?.runId]).toContain(firstRun!.id);
    await settleTasks([auth.userId]);
  });

  it("serializes concurrent claimants at the platform limit", async () => {
    const limitedRepository = new SchedulerRepository(database, { platformConcurrency: 1 });
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
        { type: "review" },
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
    await repository.enqueueRun(writerAuth, project!.id, { type: "write" });
    await repository.enqueueRun(writerAuth, project!.id, { type: "write" });

    const first = await repository.claimNextTask("write-worker-a", 30_000);
    const second = await repository.claimNextTask("write-worker-b", 30_000);

    expect(first?.projectId).toBe(project!.id);
    expect(second?.projectId).not.toBe(project!.id);
    await settleTasks([writer!.id]);
  });

  it("renews, releases, and recovers an expired lease", async () => {
    await database.update(users).set({ concurrencyLimit: 2 }).where(eq(users.id, auth.userId));
    const [thirdProject] = await database.insert(projects).values({ userId: auth.userId, title: "Third" }).returning();
    const run = await repository.enqueueRun(auth, thirdProject!.id, { type: "review" });
    expect(run).not.toBeNull();
    const claimed = await repository.claimNextTask("worker-c", 30_000);
    expect(claimed?.runId).toBe(run!.id);
    expect(await repository.renewLease(claimed!.id, "worker-c", 60_000)).toBe(true);
    expect(await repository.releaseLease(claimed!.id, "worker-c", { status: "completed" })).toBe(true);
    expect(await repository.releaseLease(claimed!.id, "worker-c", { status: "completed" })).toBe(false);

    const expiredRun = await repository.enqueueRun(auth, thirdProject!.id, { type: "maintenance" });
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
});
