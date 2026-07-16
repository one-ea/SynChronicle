import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDatabase, type Database } from "../db/client.js";
import { migrateDatabase } from "../db/migrate.js";
import { projects, runs, users } from "../db/schema/index.js";
import { QuotaError, quotaPolicy } from "./policy.js";
import { DatabaseQuotaLedger } from "./ledger.js";
import { quotaGuardedModel } from "./model.js";

describe("quota policy", () => {
  it("rejects platform calls with unknown pricing", () => {
    expect(() => quotaPolicy({ balanceUsd: 10, budgetRemainingUsd: 10, estimatedCostUsd: null }))
      .toThrowError(new QuotaError("PRICE_UNKNOWN"));
  });

  it("rejects estimates exceeding either balance or budget", () => {
    expect(() => quotaPolicy({ balanceUsd: 2, budgetRemainingUsd: 10, estimatedCostUsd: 3 })).toThrow("INSUFFICIENT_BALANCE");
    expect(() => quotaPolicy({ balanceUsd: 10, budgetRemainingUsd: 2, estimatedCostUsd: 3 })).toThrow("BUDGET_EXCEEDED");
  });
});

describe("quota guarded platform model", () => {
  it("reserves before the call and settles returned usage", async () => {
    const calls: string[] = [];
    const ledger = { reserve: vi.fn(async () => { calls.push("reserve"); return { id: "reservation", balance: 9 }; }), settle: vi.fn(async () => { calls.push("settle"); return { id: "settlement", balance: 8 }; }), release: vi.fn() };
    const model = quotaGuardedModel({ provider: "openai", modelName: "gpt", userId: randomUUID(), projectId: randomUUID(), runId: randomUUID(), agent: "writer", inputPrice: 1, outputPrice: 2, ledger: ledger as never, model: { provider: "openai", modelId: "gpt", doGenerate: async () => { calls.push("call"); return { usage: { inputTokens: 1_000_000, outputTokens: 500_000 } }; } } as never });
    await (model as never as { doGenerate(input: unknown): Promise<unknown> }).doGenerate({ prompt: "hello", maxOutputTokens: 500_000 });
    expect(calls).toEqual(["reserve", "call", "settle"]);
    expect(ledger.settle).toHaveBeenCalledWith(expect.objectContaining({ actualCostUsd: 2 }));
  });

  it("releases the reservation when the provider fails", async () => {
    const ledger = { reserve: vi.fn(async () => ({ id: "reservation", balance: 9 })), settle: vi.fn(), release: vi.fn(async () => ({ id: "release", balance: 10 })) };
    const model = quotaGuardedModel({ provider: "openai", modelName: "gpt", userId: randomUUID(), projectId: randomUUID(), runId: randomUUID(), agent: "writer", inputPrice: 1, outputPrice: 2, ledger: ledger as never, model: { provider: "openai", modelId: "gpt", doGenerate: async () => { throw new Error("provider failed"); } } as never });
    await expect((model as never as { doGenerate(input: unknown): Promise<unknown> }).doGenerate({ prompt: "hello" })).rejects.toThrow("provider failed");
    expect(ledger.release).toHaveBeenCalledOnce();
  });
});

const databaseUrl = process.env.TEST_DATABASE_URL;
const postgres = databaseUrl ? describe : describe.skip;

postgres("PostgreSQL quota ledger", () => {
  let db: Database;
  let ledger: DatabaseQuotaLedger;
  let userId: string;
  let projectId: string;
  let runId: string;

  beforeAll(async () => {
    await migrateDatabase(databaseUrl!);
    db = createDatabase(databaseUrl!);
    ledger = new DatabaseQuotaLedger(db);
    const [user] = await db.insert(users).values({ username: `quota-${randomUUID()}`, passwordHash: "test" }).returning();
    const [project] = await db.insert(projects).values({ userId: user!.id, title: "Quota" }).returning();
    const [run] = await db.insert(runs).values({ userId: user!.id, projectId: project!.id }).returning();
    userId = user!.id;
    projectId = project!.id;
    runId = run!.id;
    await ledger.credit(userId, 10, `seed:${userId}`);
  });

  afterAll(async () => db.$client.end());

  it("serializes concurrent reserve without overspending", async () => {
    const results = await Promise.allSettled([
      ledger.reserve({ userId, projectId, runId, modelCallId: randomUUID(), estimatedCostUsd: 7 }),
      ledger.reserve({ userId, projectId, runId, modelCallId: randomUUID(), estimatedCostUsd: 7 }),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(await ledger.balance(userId)).toBe(3);
  });

  it("settles actual usage exactly once", async () => {
    await ledger.credit(userId, 10, `topup:${randomUUID()}`);
    const modelCallId = randomUUID();
    const reservation = await ledger.reserve({ userId, projectId, runId, modelCallId, estimatedCostUsd: 5 });
    await ledger.settle({ reservationId: reservation.id, userId, projectId, runId, modelCallId, actualCostUsd: 3.25, usageId: "usage-1", usage: { inputTokens: 4 } });
    await ledger.settle({ reservationId: reservation.id, userId, projectId, runId, modelCallId, actualCostUsd: 3.25, usageId: "usage-1", usage: { inputTokens: 4 } });
    expect(await ledger.balance(userId)).toBe(9.75);
  });

  it("releases an abandoned reservation during reconciliation", async () => {
    const modelCallId = randomUUID();
    await ledger.reserve({ userId, projectId, runId, modelCallId, estimatedCostUsd: 2 });
    expect(await ledger.reconcile({ olderThan: new Date(Date.now() + 1_000) })).toBeGreaterThanOrEqual(1);
    expect(await ledger.reservationState(runId, modelCallId)).toBe("released");
  });
});
