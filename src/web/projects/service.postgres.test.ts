import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../../db/client.js";
import { migrateDatabase } from "../../db/migrate.js";
import { auditEvents, projects, users } from "../../db/schema/index.js";
import { AuditRepository } from "../audit/repository.js";
import type { RequestAuth } from "../auth/plugin.js";
import { ProjectRepository } from "./repository.js";
import { asProjectExecutor, databaseTransactionRunner, ProjectMutationService } from "./service.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const postgres = testDatabaseUrl ? describe : describe.skip;

postgres("PostgreSQL project audit transactions", () => {
  let database: Database;
  let auth: RequestAuth;
  let service: ProjectMutationService;

  beforeAll(async () => {
    await migrateDatabase(testDatabaseUrl!);
    database = createDatabase(testDatabaseUrl!);
    const [user] = await database.insert(users).values({
      username: `project-audit-${randomUUID()}`,
      passwordHash: "test",
    }).returning();
    auth = { userId: user!.id, role: "user", sessionId: randomUUID() };
    service = new ProjectMutationService(
      databaseTransactionRunner(database),
      (executor) => new ProjectRepository(asProjectExecutor(executor)),
      (executor) => new AuditRepository(asProjectExecutor(executor)),
      new AuditRepository(database),
    );
  });

  afterAll(async () => {
    await database.$client.end();
  });

  async function reserveAuditKey(action: string, requestId: string) {
    await database.insert(auditEvents).values({
      userId: auth.userId,
      action,
      targetType: "project",
      result: "reserved",
      requestId,
    });
  }

  it("rolls back create when the audit uniqueness constraint fails", async () => {
    const requestId = randomUUID();
    const title = `create-${randomUUID()}`;
    await reserveAuditKey("project.create", requestId);

    await expect(service.create(auth, { title }, requestId)).rejects.toThrow();

    const stored = await database.select().from(projects).where(
      and(eq(projects.userId, auth.userId), eq(projects.title, title)),
    );
    expect(stored).toEqual([]);
  });

  it("rolls back update when the audit uniqueness constraint fails", async () => {
    const [project] = await database.insert(projects).values({ userId: auth.userId, title: "Original" }).returning();
    const requestId = randomUUID();
    await reserveAuditKey("project.update", requestId);

    await expect(service.update(auth, project!.id, { title: "Changed", version: 1 }, requestId)).rejects.toThrow();

    const [stored] = await database.select().from(projects).where(eq(projects.id, project!.id));
    expect(stored).toMatchObject({ title: "Original", version: 1 });
  });

  it("rolls back archive when the audit uniqueness constraint fails", async () => {
    const [project] = await database.insert(projects).values({ userId: auth.userId, title: "Active" }).returning();
    const requestId = randomUUID();
    await reserveAuditKey("project.archive", requestId);

    await expect(service.archive(auth, project!.id, 1, requestId)).rejects.toThrow();

    const [stored] = await database.select().from(projects).where(eq(projects.id, project!.id));
    expect(stored).toMatchObject({ status: "active", archivedAt: null, version: 1 });
  });
});
