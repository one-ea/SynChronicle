import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { count, eq } from "drizzle-orm";
import { createDatabase, type Database } from "../../db/client.js";
import { migrateDatabase } from "../../db/migrate.js";
import { auditEvents, platformModels, platformSettings, quotaLedger, users } from "../../db/schema/index.js";
import { setUserConcurrency } from "../usage/routes.js";
import { DatabaseAdminRepository } from "./routes.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const postgres = databaseUrl ? describe : describe.skip;

postgres("PostgreSQL admin repository", () => {
  let db: Database;
  let repository: DatabaseAdminRepository;
  let adminId: string;
  let userId: string;

  beforeAll(async () => {
    await migrateDatabase(databaseUrl!);
    db = createDatabase(databaseUrl!);
    repository = new DatabaseAdminRepository(db);
    const [admin, user] = await db.insert(users).values([{ username: `admin-${randomUUID()}`, passwordHash: "x", role: "admin" }, { username: `user-${randomUUID()}`, passwordHash: "x" }]).returning();
    adminId = admin!.id;
    userId = user!.id;
  });
  afterAll(async () => db.$client.end());

  it("commits one balance entry and one audit for a retried request", async () => {
    const auth = { userId: adminId, role: "admin" as const, sessionId: "s" };
    const requestId = randomUUID();
    await repository.setBalance(auth, { userId, amountUsd: 5, reason: "test" }, requestId);
    await repository.setBalance(auth, { userId, amountUsd: 5, reason: "test" }, requestId);
    expect((await db.select({ value: count() }).from(quotaLedger).where(eq(quotaLedger.idempotencyKey, `admin:${requestId}:balance`)))[0]!.value).toBe(1);
    expect((await db.select({ value: count() }).from(auditEvents).where(eq(auditEvents.requestId, requestId)))[0]!.value).toBe(1);
  });

  it("requires disable before delete and audits deletion", async () => {
    const auth = { userId: adminId, role: "admin" as const, sessionId: "s" };
    const created = await repository.createModel(auth, { provider: `test-${randomUUID()}`, model: "m", status: "active", inputPrice: 1, outputPrice: 1, credentialReference: "env:TEST_PLATFORM_KEY" }, randomUUID()) as { id: string };
    expect(await repository.deleteModel(auth, created.id, randomUUID())).toBe("active");
    await repository.updateModel(auth, created.id, { status: "disabled" }, randomUUID());
    expect(await repository.deleteModel(auth, created.id, randomUUID())).toBe("deleted");
    expect(await db.select().from(platformModels).where(eq(platformModels.id, created.id))).toHaveLength(0);
  });

  it("serializes administrator cap reduction with user updates", async () => {
    const auth = { userId: adminId, role: "admin" as const, sessionId: "s" };
    await repository.setPlatformConcurrency(auth, 10, randomUUID());
    await Promise.all([repository.setPlatformConcurrency(auth, 2, randomUUID()), setUserConcurrency(db, userId, 9, randomUUID())]);
    const [setting] = await db.select().from(platformSettings).where(eq(platformSettings.id, 1));
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user!.concurrencyLimit).toBeLessThanOrEqual(setting!.concurrencyLimit);
  });
});
