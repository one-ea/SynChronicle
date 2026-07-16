import { eq } from "drizzle-orm";
import { createDatabase } from "../src/db/client.js";
import { platformModels, quotaLedger, userModelSets, users } from "../src/db/schema/index.js";
import { hashPassword } from "../src/web/auth/password.js";

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");
const database = createDatabase(databaseUrl);

try {
  const passwordHash = await hashPassword("correct horse battery staple");
  const identities = [
    { username: "alice", role: "user" as const },
    { username: "bob", role: "user" as const },
  ];
  for (const identity of identities) {
    const [user] = await database.insert(users).values({ ...identity, passwordHash, concurrencyLimit: 2 }).onConflictDoUpdate({ target: users.username, set: { passwordHash, status: "active", concurrencyLimit: 2 } }).returning();
    const agents = Object.fromEntries(["architect", "writer", "editor"].map((role) => [role, { provider: "e2e", model: "deterministic" }]));
    const existing = await database.select({ id: userModelSets.id }).from(userModelSets).where(eq(userModelSets.userId, user!.id)).limit(1);
    if (!existing.length) await database.insert(userModelSets).values({ userId: user!.id, name: "E2E deterministic", version: 1, agents, active: 1 });
    const balance = await database.select({ id: quotaLedger.id }).from(quotaLedger).where(eq(quotaLedger.userId, user!.id)).limit(1);
    if (!balance.length) await database.insert(quotaLedger).values({ userId: user!.id, operation: "credit", idempotencyKey: `e2e-seed:${identity.username}`, source: "e2e_seed", amount: "100", balance: "100" });
  }
  await database.insert(platformModels).values({ provider: "e2e", model: "deterministic", status: "active", inputPrice: "0", outputPrice: "0", credentialReference: "env:E2E_FAKE_KEY", metadata: { pricingKnown: true } }).onConflictDoNothing();
  await database.insert(platformModels).values({ provider: "e2e", model: "deterministic-v2", status: "active", inputPrice: "0", outputPrice: "0", credentialReference: "env:E2E_FAKE_KEY", metadata: { pricingKnown: true } }).onConflictDoNothing();
} finally {
  await database.$client.end();
}
