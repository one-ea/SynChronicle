import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDatabase } from "../../db/client.js";
import { migrateDatabase } from "../../db/migrate.js";
import { userModelSets, users } from "../../db/schema/index.js";
import { ModelConfigurationRepository } from "./repository.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const conditional = databaseUrl ? describe : describe.skip;

conditional("model configuration PostgreSQL", () => {
  it("keeps one active model-set version per tenant under concurrent activation", async () => {
    await migrateDatabase(databaseUrl!);
    const db = createDatabase(databaseUrl!);
    const userId = randomUUID(), first = randomUUID(), second = randomUUID();
    await db.insert(users).values({ id: userId, username: `models-${userId}`, passwordHash: "hash" });
    await db.insert(userModelSets).values([{ userId, modelSetId: first, name: "First", version: 1, agents: {} }, { userId, modelSetId: second, name: "Second", version: 1, agents: {} }]);
    const repository = new ModelConfigurationRepository(db);
    const auth = { userId, role: "user" as const, sessionId: randomUUID() };
    await Promise.all([repository.activate(auth, first), repository.activate(auth, second)]);
    const active = await db.select().from(userModelSets).where(eq(userModelSets.userId, userId));
    expect(active.filter(({ active }) => active === 1)).toHaveLength(1);
    await db.$client.end();
  });
});
