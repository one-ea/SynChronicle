import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDatabase, type Database } from "../db/client.js";
import { eq } from "drizzle-orm";
import { migrateDatabase } from "../db/migrate.js";
import { projects, runs, tasks, users } from "../db/schema/index.js";
import { QuotaError, quotaPolicy } from "./policy.js";
import { DatabaseQuotaLedger, startQuotaMaintenance } from "./ledger.js";
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

it("periodically reconciles reservations and retries settlement outbox", async () => {
  vi.useFakeTimers();
  const ledger = { reconcile: vi.fn(async () => 0) };
  const stop = startQuotaMaintenance(ledger as never, { intervalMs: 1000, staleAfterMs: 5000 });
  await vi.advanceTimersByTimeAsync(3100);
  expect(ledger.reconcile).toHaveBeenCalledTimes(3);
  stop();
  vi.useRealTimers();
});

describe("quota guarded platform model", () => {
  it("reserves before the call and settles returned usage", async () => {
    const calls: string[] = [];
    const ledger = { acquireModelCall: vi.fn(async () => ({ id: "call" })), reserve: vi.fn(async () => { calls.push("reserve"); return { id: "reservation", balance: 9 }; }), settleDurably: vi.fn(async () => { calls.push("settle"); }), releaseDurably: vi.fn(), heartbeat: vi.fn() };
    const model = quotaGuardedModel({ provider: "openai", modelName: "gpt", userId: randomUUID(), projectId: randomUUID(), runId: randomUUID(), taskId: randomUUID(), leaseVersion: 1, agent: "writer", inputPrice: 1, outputPrice: 2, ledger: ledger as never, model: { provider: "openai", modelId: "gpt", doGenerate: async () => { calls.push("call"); return { usage: { inputTokens: 1_000_000, outputTokens: 500_000 } }; } } as never });
    await (model as never as { doGenerate(input: unknown): Promise<unknown> }).doGenerate({ prompt: "hello", maxOutputTokens: 500_000 });
    expect(calls).toEqual(["reserve", "call", "settle"]);
    expect(ledger.settleDurably).toHaveBeenCalledWith(expect.objectContaining({ actualCostUsd: 2 }));
  });

  it("releases the reservation when the provider fails", async () => {
    const ledger = { acquireModelCall: vi.fn(async () => ({ id: "call" })), reserve: vi.fn(async () => ({ id: "reservation", balance: 9 })), settleDurably: vi.fn(), releaseDurably: vi.fn(async () => undefined), heartbeat: vi.fn() };
    const model = quotaGuardedModel({ provider: "openai", modelName: "gpt", userId: randomUUID(), projectId: randomUUID(), runId: randomUUID(), taskId: randomUUID(), leaseVersion: 1, agent: "writer", inputPrice: 1, outputPrice: 2, ledger: ledger as never, model: { provider: "openai", modelId: "gpt", doGenerate: async () => { throw new Error("provider failed"); } } as never });
    await expect((model as never as { doGenerate(input: unknown): Promise<unknown> }).doGenerate({ prompt: "hello" })).rejects.toThrow("provider failed");
    expect(ledger.releaseDurably).toHaveBeenCalledOnce();
  });

  it("keeps the reservation when durable settlement enqueue fails after provider success", async () => {
    const ledger = { acquireModelCall: vi.fn(async () => ({ id: "call" })), reserve: vi.fn(async () => ({ id: "reservation", balance: 9 })), settleDurably: vi.fn(async () => { throw new Error("database unavailable"); }), releaseDurably: vi.fn(), heartbeat: vi.fn() };
    const model = quotaGuardedModel({ provider: "openai", modelName: "gpt", userId: randomUUID(), projectId: randomUUID(), runId: randomUUID(), taskId: randomUUID(), leaseVersion: 1, agent: "writer", inputPrice: 1, outputPrice: 2, ledger: ledger as never, model: { provider: "openai", modelId: "gpt", doGenerate: async () => ({ usage: { inputTokens: 1 } }) } as never });
    await expect((model as never as { doGenerate(input: unknown): Promise<unknown> }).doGenerate({ prompt: "hello" })).rejects.toThrow("database unavailable");
    expect(ledger.releaseDurably).not.toHaveBeenCalled();
  });

  it("assigns different durable call IDs to identical independent calls", async () => {
    const reserved: string[] = [];
    const ledger = { acquireModelCall: vi.fn(async ({ sequence }) => ({ id: `call-${sequence}` })), reserve: vi.fn(async ({ modelCallId }) => { reserved.push(modelCallId); return { id: `r-${modelCallId}`, balance: 9 }; }), settleDurably: vi.fn(), releaseDurably: vi.fn(), heartbeat: vi.fn() };
    const model = quotaGuardedModel({ provider: "openai", modelName: "gpt", userId: randomUUID(), projectId: randomUUID(), runId: randomUUID(), taskId: randomUUID(), leaseVersion: 4, agent: "writer", inputPrice: 1, outputPrice: 1, ledger: ledger as never, model: { provider: "openai", modelId: "gpt", doGenerate: async () => ({ usage: {} }) } as never });
    const invocation = model as never as { doGenerate(input: unknown): Promise<unknown> };
    await invocation.doGenerate({ prompt: "same" });
    await invocation.doGenerate({ prompt: "same" });
    expect(reserved).toEqual(["call-1", "call-2"]);
  });

  it("reuses the persisted call ID when the same task invocation sequence retries", async () => {
    const persisted = new Map<number, string>();
    const ledger = { acquireModelCall: vi.fn(async ({ sequence }) => ({ id: persisted.get(sequence) ?? (persisted.set(sequence, randomUUID()), persisted.get(sequence)!) })), reserve: vi.fn(async ({ modelCallId }) => ({ id: `r-${modelCallId}`, balance: 9 })), settleDurably: vi.fn(), releaseDurably: vi.fn(), heartbeat: vi.fn() };
    const base = { provider: "openai", modelName: "gpt", userId: randomUUID(), projectId: randomUUID(), runId: randomUUID(), taskId: randomUUID(), leaseVersion: 4, agent: "writer", inputPrice: 1, outputPrice: 1, ledger: ledger as never, model: { provider: "openai", modelId: "gpt", doGenerate: async () => ({ usage: {} }) } as never };
    await (quotaGuardedModel(base) as never as { doGenerate(input: unknown): Promise<unknown> }).doGenerate({ prompt: "same" });
    await (quotaGuardedModel(base) as never as { doGenerate(input: unknown): Promise<unknown> }).doGenerate({ prompt: "same" });
    expect(ledger.reserve.mock.calls[0]![0].modelCallId).toBe(ledger.reserve.mock.calls[1]![0].modelCallId);
  });

  it("continues after the latest checkpoint cursor while reusing post-checkpoint retries", async () => {
    const ledger = { modelCallCursor: vi.fn(async () => 2), acquireModelCall: vi.fn(async ({ sequence }) => ({ id: `call-${sequence}` })), reserve: vi.fn(async ({ modelCallId }) => ({ id: `r-${modelCallId}`, balance: 9 })), settleDurably: vi.fn(), releaseDurably: vi.fn(), heartbeat: vi.fn() };
    const model = quotaGuardedModel({ provider: "openai", modelName: "gpt", userId: randomUUID(), projectId: randomUUID(), runId: randomUUID(), taskId: randomUUID(), leaseVersion: 4, agent: "writer", inputPrice: 1, outputPrice: 1, ledger: ledger as never, model: { provider: "openai", modelId: "gpt", doGenerate: async () => ({ usage: {} }) } as never });
    await (model as never as { doGenerate(input: unknown): Promise<unknown> }).doGenerate({ prompt: "next" });
    expect(ledger.acquireModelCall).toHaveBeenCalledWith(expect.objectContaining({ sequence: 3 }));
  });

  it("durably releases a stream reservation when the consumer cancels", async () => {
    const ledger = { acquireModelCall: vi.fn(async () => ({ id: "call" })), reserve: vi.fn(async () => ({ id: "reservation", balance: 9 })), settleDurably: vi.fn(), releaseDurably: vi.fn(), heartbeat: vi.fn() };
    const source = new ReadableStream({ start(controller) { controller.enqueue({ type: "text-delta", delta: "x" }); } });
    const model = quotaGuardedModel({ provider: "openai", modelName: "gpt", userId: randomUUID(), projectId: randomUUID(), runId: randomUUID(), taskId: randomUUID(), leaseVersion: 1, agent: "writer", inputPrice: 1, outputPrice: 1, ledger: ledger as never, model: { provider: "openai", modelId: "gpt", doStream: async () => ({ stream: source }) } as never });
    const result = await (model as never as { doStream(input: unknown): Promise<{ stream: ReadableStream }> }).doStream({ prompt: "x" });
    const reader = result.stream.getReader();
    await reader.read();
    await reader.cancel();
    expect(ledger.releaseDurably).toHaveBeenCalledOnce();
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
  let taskId: string;

  beforeAll(async () => {
    await migrateDatabase(databaseUrl!);
    db = createDatabase(databaseUrl!);
    ledger = new DatabaseQuotaLedger(db);
    const [user] = await db.insert(users).values({ username: `quota-${randomUUID()}`, passwordHash: "test" }).returning();
    const [project] = await db.insert(projects).values({ userId: user!.id, title: "Quota" }).returning();
    const [run] = await db.insert(runs).values({ userId: user!.id, projectId: project!.id }).returning();
    const [task] = await db.insert(tasks).values({ userId: user!.id, projectId: project!.id, runId: run!.id, type: "write", status: "running", leaseOwner: "quota-test", leaseExpiresAt: new Date(Date.now() + 60_000), leaseVersion: 1 }).returning();
    userId = user!.id;
    projectId = project!.id;
    runId = run!.id;
    taskId = task!.id;
    await ledger.credit(userId, 10, `seed:${userId}`);
  });

  afterAll(async () => db.$client.end());

  it("serializes concurrent reserve without overspending", async () => {
    const results = await Promise.allSettled([
      ledger.acquireModelCall({ taskId, runId, scope: "writer:model", sequence: 1, leaseVersion: 1 }).then(({ id: modelCallId }) => ledger.reserve({ userId, projectId, runId, taskId, leaseVersion: 1, modelCallId, estimatedCostUsd: 7 })),
      ledger.acquireModelCall({ taskId, runId, scope: "writer:model", sequence: 2, leaseVersion: 1 }).then(({ id: modelCallId }) => ledger.reserve({ userId, projectId, runId, taskId, leaseVersion: 1, modelCallId, estimatedCostUsd: 7 })),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(await ledger.balance(userId)).toBe(3);
  });

  it("settles actual usage exactly once", async () => {
    await ledger.credit(userId, 10, `topup:${randomUUID()}`);
    const { id: modelCallId } = await ledger.acquireModelCall({ taskId, runId, scope: "writer:model", sequence: 3, leaseVersion: 1 });
    const reservation = await ledger.reserve({ userId, projectId, runId, taskId, leaseVersion: 1, modelCallId, estimatedCostUsd: 5 });
    await ledger.settle({ reservationId: reservation.id, userId, projectId, runId, taskId, leaseVersion: 1, modelCallId, actualCostUsd: 3.25, usageId: "usage-1", usage: { inputTokens: 4 } });
    await ledger.settle({ reservationId: reservation.id, userId, projectId, runId, taskId, leaseVersion: 1, modelCallId, actualCostUsd: 3.25, usageId: "usage-1", usage: { inputTokens: 4 } });
    expect(await ledger.balance(userId)).toBe(9.75);
  });

  it("releases an abandoned reservation during reconciliation", async () => {
    const { id: modelCallId } = await ledger.acquireModelCall({ taskId, runId, scope: "writer:model", sequence: 4, leaseVersion: 1 });
    await ledger.reserve({ userId, projectId, runId, taskId, leaseVersion: 1, modelCallId, estimatedCostUsd: 2 });
    await db.update(tasks).set({ leaseExpiresAt: new Date(Date.now() - 1), status: "failed" }).where(eq(tasks.id, taskId));
    expect(await ledger.reconcile({ olderThan: new Date(Date.now() + 1_000) })).toBeGreaterThanOrEqual(1);
    expect(await ledger.reservationState(runId, modelCallId)).toBe("released");
  });

  it("keeps a stale-heartbeat reservation while its task lease is valid", async () => {
    await db.update(tasks).set({ leaseExpiresAt: new Date(Date.now() + 60_000), status: "running" }).where(eq(tasks.id, taskId));
    const { id: modelCallId } = await ledger.acquireModelCall({ taskId, runId, scope: "writer:model", sequence: 5, leaseVersion: 1 });
    await ledger.reserve({ userId, projectId, runId, taskId, leaseVersion: 1, modelCallId, estimatedCostUsd: 1 });
    expect(await ledger.reconcile({ olderThan: new Date(Date.now() + 1_000) })).toBe(0);
    expect(await ledger.reservationState(runId, modelCallId)).toBe("reserved");
  });
});
