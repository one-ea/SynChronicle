import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDatabase, type Database } from "../db/client.js";
import { eq } from "drizzle-orm";
import { migrateDatabase } from "../db/migrate.js";
import { projects, quotaReservations, runs, tasks, users } from "../db/schema/index.js";
import { QuotaError, quotaPolicy } from "./policy.js";
import { DatabaseQuotaLedger, startQuotaMaintenance } from "./ledger.js";
import { quotaGuardedModel } from "./model.js";
import { hasKnownPlatformPrice } from "./pricing.js";

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

describe("platform pricing policy", () => {
  it("treats priceStatus unknown as unavailable even with residual numeric prices", () => {
    expect(hasKnownPlatformPrice({ priceStatus: "unknown" }, "1.25", "2.5")).toBe(false);
    expect(hasKnownPlatformPrice({}, "1.25", "2.5")).toBe(true);
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
    const ledger = { reserve: vi.fn(async () => { calls.push("reserve"); return { id: "reservation", balance: 9 }; }), markProviderStarted: vi.fn(async () => { calls.push("started"); }), settleDurably: vi.fn(async () => { calls.push("settle"); }), settleInterrupted: vi.fn(), heartbeat: vi.fn() };
    const model = quotaGuardedModel({ provider: "openai", modelName: "gpt", userId: randomUUID(), projectId: randomUUID(), runId: randomUUID(), taskId: randomUUID(), leaseVersion: 1, agent: "writer", inputPrice: 1, outputPrice: 2, ledger: ledger as never, model: { provider: "openai", modelId: "gpt", doGenerate: async () => { calls.push("call"); return { usage: { inputTokens: 1_000_000, outputTokens: 500_000 } }; } } as never });
    await (model as never as { doGenerate(input: unknown): Promise<unknown> }).doGenerate(callOptions("call", { prompt: "hello", maxOutputTokens: 500_000 }));
    expect(calls).toEqual(["reserve", "started", "call", "settle"]);
    expect(ledger.settleDurably).toHaveBeenCalledWith(expect.objectContaining({ actualCostUsd: 2 }));
  });

  it("estimate-settles the reservation when the provider fails after starting", async () => {
    const ledger = { reserve: vi.fn(async () => ({ id: "reservation", balance: 9 })), markProviderStarted: vi.fn(), settleDurably: vi.fn(), settleInterrupted: vi.fn(async () => undefined), heartbeat: vi.fn() };
    const model = quotaGuardedModel({ provider: "openai", modelName: "gpt", userId: randomUUID(), projectId: randomUUID(), runId: randomUUID(), taskId: randomUUID(), leaseVersion: 1, agent: "writer", inputPrice: 1, outputPrice: 2, ledger: ledger as never, model: { provider: "openai", modelId: "gpt", doGenerate: async () => { throw new Error("provider failed"); } } as never });
    await expect((model as never as { doGenerate(input: unknown): Promise<unknown> }).doGenerate(callOptions("call", { prompt: "hello" }))).rejects.toThrow("provider failed");
    expect(ledger.settleInterrupted).toHaveBeenCalledOnce();
  });

  it("blocks the provider when provider_started cannot be persisted", async () => {
    const provider = vi.fn(async () => ({ usage: {} }));
    const ledger = { reserve: vi.fn(async () => ({ id: "reservation", balance: 9 })), markProviderStarted: vi.fn(async () => { throw new Error("database unavailable"); }), settleDurably: vi.fn(), settleInterrupted: vi.fn(), heartbeat: vi.fn() };
    const model = quotaGuardedModel({ provider: "openai", modelName: "gpt", userId: randomUUID(), projectId: randomUUID(), runId: randomUUID(), taskId: randomUUID(), leaseVersion: 1, agent: "writer", inputPrice: 1, outputPrice: 2, ledger: ledger as never, model: { provider: "openai", modelId: "gpt", doGenerate: provider } as never });
    await expect((model as never as { doGenerate(input: unknown): Promise<unknown> }).doGenerate(callOptions("call", { prompt: "hello" }))).rejects.toThrow("database unavailable");
    expect(provider).not.toHaveBeenCalled();
  });

  it("releases a reservation when local provider preflight fails before provider_started", async () => {
    const calls: string[] = [];
    const ledger = { reserve: vi.fn(async () => { calls.push("reserve"); return { id: "reservation", balance: 9 }; }), markProviderStarted: vi.fn(async () => { calls.push("started"); }), settleDurably: vi.fn(), settleInterrupted: vi.fn(), releaseDurably: vi.fn(async () => { calls.push("release"); }), heartbeat: vi.fn() };
    const model = quotaGuardedModel({ provider: "openai", modelName: "gpt", userId: randomUUID(), projectId: randomUUID(), runId: randomUUID(), taskId: randomUUID(), leaseVersion: 1, agent: "writer", inputPrice: 1, outputPrice: 1, ledger: ledger as never, model: { provider: "openai", modelId: "gpt", prepare: async () => { throw new Error("credential unavailable"); } } as never });

    await expect((model as never as { doGenerate(input: unknown): Promise<unknown> }).doGenerate(callOptions("call", {}))).rejects.toThrow("credential unavailable");

    expect(calls).toEqual(["reserve", "release"]);
    expect(ledger.releaseDurably).toHaveBeenCalledWith(expect.objectContaining({ reason: "provider_preflight_failed", errorCategory: "local_preflight" }));
  });

  it("uses durable invocation IDs across concurrent model wrappers", async () => {
    const reserved: string[] = [];
    const ledger = { allocateModelCall: vi.fn(), reserve: vi.fn(async ({ modelCallId }) => { reserved.push(modelCallId); return { id: `r-${modelCallId}`, balance: 9 }; }), markProviderStarted: vi.fn(), settleDurably: vi.fn(), settleInterrupted: vi.fn(), heartbeat: vi.fn() };
    const base = { provider: "openai", modelName: "gpt", userId: randomUUID(), projectId: randomUUID(), runId: randomUUID(), taskId: randomUUID(), leaseVersion: 4, agent: "writer", inputPrice: 1, outputPrice: 1, ledger: ledger as never, model: { provider: "openai", modelId: "gpt", doGenerate: async () => ({ usage: {} }) } as never };
    const first = quotaGuardedModel(base) as never as { doGenerate(input: unknown): Promise<unknown> };
    const second = quotaGuardedModel(base) as never as { doGenerate(input: unknown): Promise<unknown> };
    await Promise.all([first.doGenerate(callOptions("11111111-1111-4111-8111-111111111111", { prompt: "same" })), second.doGenerate(callOptions("22222222-2222-4222-8222-222222222222", { prompt: "same" }))]);
    expect(reserved.sort()).toEqual(["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"]);
    expect(ledger.allocateModelCall).not.toHaveBeenCalled();
  });

  it("reuses the persisted call ID when the same task invocation sequence retries", async () => {
    const ledger = { reserve: vi.fn(async ({ modelCallId }) => ({ id: `r-${modelCallId}`, balance: 9 })), markProviderStarted: vi.fn(), settleDurably: vi.fn(), settleInterrupted: vi.fn(), heartbeat: vi.fn() };
    const base = { provider: "openai", modelName: "gpt", userId: randomUUID(), projectId: randomUUID(), runId: randomUUID(), taskId: randomUUID(), leaseVersion: 4, agent: "writer", inputPrice: 1, outputPrice: 1, ledger: ledger as never, model: { provider: "openai", modelId: "gpt", doGenerate: async () => ({ usage: {} }) } as never };
    const callId = "33333333-3333-4333-8333-333333333333";
    await (quotaGuardedModel(base) as never as { doGenerate(input: unknown): Promise<unknown> }).doGenerate(callOptions(callId, { prompt: "same" }));
    await (quotaGuardedModel(base) as never as { doGenerate(input: unknown): Promise<unknown> }).doGenerate(callOptions(callId, { prompt: "same" }));
    expect(ledger.reserve.mock.calls[0]![0].modelCallId).toBe(ledger.reserve.mock.calls[1]![0].modelCallId);
  });

  it("rejects calls without a durable invocation context", async () => {
    const ledger = { reserve: vi.fn(), settleDurably: vi.fn(), releaseDurably: vi.fn(), heartbeat: vi.fn() };
    const model = quotaGuardedModel({ provider: "openai", modelName: "gpt", userId: randomUUID(), projectId: randomUUID(), runId: randomUUID(), taskId: randomUUID(), leaseVersion: 4, agent: "writer", inputPrice: 1, outputPrice: 1, ledger: ledger as never, model: { provider: "openai", modelId: "gpt", doGenerate: async () => ({ usage: {} }) } as never });
    await expect((model as never as { doGenerate(input: unknown): Promise<unknown> }).doGenerate({ prompt: "missing" })).rejects.toThrow("durable invocation ID");
  });

  it("estimate-settles a stream reservation when the consumer cancels", async () => {
    const ledger = { reserve: vi.fn(async () => ({ id: "reservation", balance: 9 })), markProviderStarted: vi.fn(), settleDurably: vi.fn(), settleInterrupted: vi.fn(), heartbeat: vi.fn() };
    const source = new ReadableStream({ start(controller) { controller.enqueue({ type: "text-delta", delta: "x" }); } });
    const model = quotaGuardedModel({ provider: "openai", modelName: "gpt", userId: randomUUID(), projectId: randomUUID(), runId: randomUUID(), taskId: randomUUID(), leaseVersion: 1, agent: "writer", inputPrice: 1, outputPrice: 1, ledger: ledger as never, model: { provider: "openai", modelId: "gpt", doStream: async () => ({ stream: source }) } as never });
    const result = await (model as never as { doStream(input: unknown): Promise<{ stream: ReadableStream }> }).doStream(callOptions("call", { prompt: "x" }));
    const reader = result.stream.getReader();
    await reader.read();
    await reader.cancel();
    expect(ledger.settleInterrupted).toHaveBeenCalledOnce();
  });

  it.each([
    ["EOF", new ReadableStream({ start(controller) { controller.close(); } })],
    ["read error", new ReadableStream({ start(controller) { controller.error(new Error("stream failed")); } })],
  ])("estimate-settles a started stream on %s without a finish usage event", async (_name, source) => {
    const ledger = { reserve: vi.fn(async () => ({ id: "reservation", balance: 9 })), markProviderStarted: vi.fn(), settleDurably: vi.fn(), settleInterrupted: vi.fn(), heartbeat: vi.fn() };
    const model = quotaGuardedModel({ provider: "openai", modelName: "gpt", userId: randomUUID(), projectId: randomUUID(), runId: randomUUID(), taskId: randomUUID(), leaseVersion: 1, agent: "writer", inputPrice: 1, outputPrice: 1, ledger: ledger as never, model: { provider: "openai", modelId: "gpt", doStream: async () => ({ stream: source }) } as never });
    const result = await (model as never as { doStream(input: unknown): Promise<{ stream: ReadableStream }> }).doStream(callOptions("call", { prompt: "x" }));
    const reader = result.stream.getReader();
    if (_name === "read error") await expect(reader.read()).rejects.toThrow("stream failed");
    else await expect(reader.read()).resolves.toMatchObject({ done: true });
    expect(ledger.settleInterrupted).toHaveBeenCalledOnce();
  });

  it("estimate-settles a finish chunk that omits usage", async () => {
    const ledger = { reserve: vi.fn(async () => ({ id: "reservation", balance: 9 })), markProviderStarted: vi.fn(), settleDurably: vi.fn(), settleInterrupted: vi.fn(), heartbeat: vi.fn() };
    const source = new ReadableStream({ start(controller) { controller.enqueue({ type: "finish", finishReason: "stop" }); controller.close(); } });
    const model = quotaGuardedModel({ provider: "openai", modelName: "gpt", userId: randomUUID(), projectId: randomUUID(), runId: randomUUID(), taskId: randomUUID(), leaseVersion: 1, agent: "writer", inputPrice: 1, outputPrice: 1, ledger: ledger as never, model: { provider: "openai", modelId: "gpt", doStream: async () => ({ stream: source }) } as never });
    const result = await (model as never as { doStream(input: unknown): Promise<{ stream: ReadableStream }> }).doStream(callOptions("call", {}));
    await result.stream.getReader().read();
    expect(ledger.settleDurably).not.toHaveBeenCalled();
    expect(ledger.settleInterrupted).toHaveBeenCalledWith(expect.objectContaining({ errorCategory: "missing_usage" }));
  });

  it("retries settlement intent persistence before returning generate completion", async () => {
    const calls: string[] = [];
    const ledger = { reserve: vi.fn(async () => ({ id: "reservation", balance: 9 })), markProviderStarted: vi.fn(), settleDurably: vi.fn(async () => { calls.push("intent"); if (calls.length < 3) throw new Error("transient"); }), settleInterrupted: vi.fn(), heartbeat: vi.fn() };
    const model = quotaGuardedModel({ provider: "openai", modelName: "gpt", userId: randomUUID(), projectId: randomUUID(), runId: randomUUID(), taskId: randomUUID(), leaseVersion: 1, agent: "writer", inputPrice: 1, outputPrice: 1, ledger: ledger as never, settlementRetry: { attempts: 3, baseDelayMs: 0 }, model: { provider: "openai", modelId: "gpt", doGenerate: async () => ({ usage: { inputTokens: 1 } }) } as never });
    await expect((model as never as { doGenerate(input: unknown): Promise<unknown> }).doGenerate(callOptions("call", {}))).resolves.toBeTruthy();
    expect(calls).toEqual(["intent", "intent", "intent"]);
  });

  it("keeps actual usage in memory until settlement intent persistence recovers", async () => {
    let attempts = 0;
    const ledger = { reserve: vi.fn(async () => ({ id: "reservation", balance: 9 })), markProviderStarted: vi.fn(), settleDurably: vi.fn(async () => { attempts++; if (attempts < 4) throw new Error("db down"); }), settleInterrupted: vi.fn(), heartbeat: vi.fn() };
    const model = quotaGuardedModel({ provider: "openai", modelName: "gpt", userId: randomUUID(), projectId: randomUUID(), runId: randomUUID(), taskId: randomUUID(), leaseVersion: 1, agent: "writer", inputPrice: 1, outputPrice: 1, ledger: ledger as never, settlementRetry: { attempts: 2, baseDelayMs: 0 }, model: { provider: "openai", modelId: "gpt", doGenerate: async () => ({ usage: { inputTokens: 1 } }) } as never });
    await expect((model as never as { doGenerate(input: unknown): Promise<unknown> }).doGenerate(callOptions("call", {}))).resolves.toBeTruthy();
    expect(ledger.settleDurably).toHaveBeenCalledTimes(4);
  });

  it("stops settlement intent retry when the lease signal is cancelled", async () => {
    const controller = new AbortController();
    const reason = new Error("lease lost");
    const ledger = { reserve: vi.fn(async () => ({ id: "reservation", balance: 9 })), markProviderStarted: vi.fn(), settleDurably: vi.fn(async () => { throw new Error("db down"); }), settleInterrupted: vi.fn(), heartbeat: vi.fn() };
    const model = quotaGuardedModel({ provider: "openai", modelName: "gpt", userId: randomUUID(), projectId: randomUUID(), runId: randomUUID(), taskId: randomUUID(), leaseVersion: 1, agent: "writer", inputPrice: 1, outputPrice: 1, ledger: ledger as never, settlementRetry: { attempts: 2, baseDelayMs: 100 }, model: { provider: "openai", modelId: "gpt", doGenerate: async () => ({ usage: { inputTokens: 1 } }) } as never });
    const pending = (model as never as { doGenerate(input: unknown): Promise<unknown> }).doGenerate(callOptions("call", { abortSignal: controller.signal }));
    await vi.waitFor(() => expect(ledger.settleDurably).toHaveBeenCalled());
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(ledger.settleInterrupted).not.toHaveBeenCalled();
  });

  it.each([
    [401, "release", "authentication"],
    [403, "release", "authentication"],
    [400, "release", "validation"],
    [404, "release", "validation"],
    [429, "release", "rate_limit"],
    [500, "estimate", "provider_unknown"],
  ] as const)("classifies Provider status %s as %s", async (statusCode, outcome, errorCategory) => {
    const error = Object.assign(new Error(`provider ${statusCode}`), { statusCode });
    const ledger = { reserve: vi.fn(async () => ({ id: "reservation", balance: 9 })), markProviderStarted: vi.fn(), settleDurably: vi.fn(), settleInterrupted: vi.fn(), releaseDurably: vi.fn(), heartbeat: vi.fn() };
    const model = quotaGuardedModel({ provider: "openai", modelName: "gpt", userId: randomUUID(), projectId: randomUUID(), runId: randomUUID(), taskId: randomUUID(), leaseVersion: 1, agent: "writer", inputPrice: 1, outputPrice: 1, ledger: ledger as never, model: { provider: "openai", modelId: "gpt", doGenerate: async () => { throw error; } } as never });
    await expect((model as never as { doGenerate(input: unknown): Promise<unknown> }).doGenerate(callOptions("call", {}))).rejects.toBe(error);
    const target = outcome === "release" ? ledger.releaseDurably : ledger.settleInterrupted;
    expect(target).toHaveBeenCalledWith(expect.objectContaining({ errorCategory, reason: "provider_rejected_or_failed" }));
  });
});

function callOptions(invocationId: string, value: Record<string, unknown>) { return { ...value, providerOptions: { synchronicle: { invocationId } } }; }

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

  it("atomically allocates unique calls across wrappers and reuses crash retries", async () => {
    const [first, second] = await Promise.all([
      ledger.allocateModelCall({ taskId, runId, scope: "writer:generate", invocationKey: `first-${randomUUID()}`, leaseVersion: 1 }),
      ledger.allocateModelCall({ taskId, runId, scope: "writer:generate", invocationKey: `second-${randomUUID()}`, leaseVersion: 1 }),
    ]);
    expect(first.id).not.toBe(second.id);
    const retryKey = `retry-${randomUUID()}`;
    const original = await ledger.allocateModelCall({ taskId, runId, scope: "writer:generate", invocationKey: retryKey, leaseVersion: 1 });
    const recovered = await ledger.allocateModelCall({ taskId, runId, scope: "writer:generate", invocationKey: retryKey, leaseVersion: 2 });
    expect(recovered.id).toBe(original.id);
  });

  it("estimate-settles a provider-started call after lease loss", async () => {
    const call = await ledger.allocateModelCall({ taskId, runId, scope: "writer:generate", invocationKey: `started-${randomUUID()}`, leaseVersion: 1 });
    const reservation = await ledger.reserve({ userId, projectId, runId, taskId, leaseVersion: 1, modelCallId: call.id, estimatedCostUsd: 1 });
    await ledger.markProviderStarted(reservation.id, taskId, 1);
    await db.update(quotaReservations).set({ heartbeatAt: new Date(Date.now() - 60_000) }).where(eq(quotaReservations.id, reservation.id));
    await db.update(tasks).set({ status: "failed", leaseExpiresAt: new Date(Date.now() - 1) }).where(eq(tasks.id, taskId));
    await ledger.reconcile({ olderThan: new Date() });
    expect(await ledger.reservationState(runId, call.id)).toBe("needs_reconciliation");
  });

  it("charges the estimate when provider completion has no actual intent", async () => {
    const call = await ledger.allocateModelCall({ taskId, runId, scope: "writer:generate", invocationKey: `estimate-${randomUUID()}`, leaseVersion: 1 });
    const reservation = await ledger.reserve({ userId, projectId, runId, taskId, leaseVersion: 1, modelCallId: call.id, estimatedCostUsd: 0.5 });
    await db.update(quotaReservations).set({ status: "provider_completed", heartbeatAt: new Date(Date.now() - 60_000) }).where(eq(quotaReservations.id, reservation.id));
    await db.update(tasks).set({ status: "failed", leaseExpiresAt: new Date(Date.now() - 1) }).where(eq(tasks.id, taskId));

    await ledger.reconcile({ olderThan: new Date() });

    expect(await ledger.reservationState(runId, call.id)).toBe("needs_reconciliation");
  });

  it("counts estimate settlements toward the user budget", async () => {
    const [budgetUser] = await db.insert(users).values({ username: `budget-${randomUUID()}`, passwordHash: "test", budgetUsd: "1" }).returning();
    const [budgetProject] = await db.insert(projects).values({ userId: budgetUser!.id, title: "Budget" }).returning();
    const [budgetRun] = await db.insert(runs).values({ userId: budgetUser!.id, projectId: budgetProject!.id }).returning();
    const [budgetTask] = await db.insert(tasks).values({ userId: budgetUser!.id, projectId: budgetProject!.id, runId: budgetRun!.id, type: "write", status: "running", leaseOwner: "quota-test", leaseExpiresAt: new Date(Date.now() + 60_000), leaseVersion: 1 }).returning();
    await ledger.credit(budgetUser!.id, 10, `seed:${budgetUser!.id}`);
    const first = await ledger.allocateModelCall({ taskId: budgetTask!.id, runId: budgetRun!.id, scope: "writer:generate", invocationKey: randomUUID(), leaseVersion: 1 });
    const reservation = await ledger.reserve({ userId: budgetUser!.id, projectId: budgetProject!.id, runId: budgetRun!.id, taskId: budgetTask!.id, leaseVersion: 1, modelCallId: first.id, estimatedCostUsd: 0.75 });
    await ledger.markProviderStarted(reservation.id, budgetTask!.id, 1);
    await ledger.settleInterrupted({ reservationId: reservation.id, userId: budgetUser!.id, projectId: budgetProject!.id, runId: budgetRun!.id, taskId: budgetTask!.id, leaseVersion: 1, modelCallId: first.id, error: "stream interrupted" });
    const second = await ledger.allocateModelCall({ taskId: budgetTask!.id, runId: budgetRun!.id, scope: "writer:generate", invocationKey: randomUUID(), leaseVersion: 1 });
    await expect(ledger.reserve({ userId: budgetUser!.id, projectId: budgetProject!.id, runId: budgetRun!.id, taskId: budgetTask!.id, leaseVersion: 1, modelCallId: second.id, estimatedCostUsd: 0.3 })).rejects.toThrow("BUDGET_EXCEEDED");
  });
});
