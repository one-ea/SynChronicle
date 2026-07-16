import { and, asc, desc, eq, inArray, lt, lte, ne, or, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { checkpoints, modelCallContexts, quotaLedger, quotaReservations, quotaSettlementOutbox, tasks, users } from "../db/schema/index.js";
import { quotaPolicy } from "./policy.js";

type Executor = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface ReserveQuotaInput {
  userId: string;
  projectId: string;
  runId: string;
  modelCallId: string;
  taskId: string;
  leaseVersion: number;
  estimatedCostUsd: number | null;
  model?: string;
}

export interface SettleQuotaInput extends Omit<ReserveQuotaInput, "estimatedCostUsd"> {
  reservationId: string;
  actualCostUsd: number;
  usageId: string;
  usage?: Record<string, unknown>;
  credentialSource?: string;
  priceSource?: string;
  latencyMs?: number;
}
export type ReleaseQuotaInput = Omit<SettleQuotaInput, "actualCostUsd" | "usageId" | "usage"> & { reason?: string; errorCategory?: string; error?: string };

const key = (runId: string, modelCallId: string, operation: string) => `${runId}:${modelCallId}:${operation}`;
const money = (value: string | number | null | undefined) => Number(value ?? 0);

export class DatabaseQuotaLedger {
  constructor(private readonly db: Database) {}

  async balance(userId: string, executor: Database | Executor = this.db): Promise<number> {
    const [row] = await executor.select({ balance: quotaLedger.balance }).from(quotaLedger).where(eq(quotaLedger.userId, userId)).orderBy(desc(quotaLedger.createdAt), desc(quotaLedger.id)).limit(1);
    return money(row?.balance);
  }

  async credit(userId: string, amountUsd: number, idempotencyKey: string, source = "admin", executor?: Executor): Promise<{ id: string; balance: number }> {
    if (!Number.isFinite(amountUsd)) throw new Error("amountUsd must be finite");
    return this.append(userId, amountUsd, { operation: "credit", idempotencyKey, source }, executor);
  }

  async acquireModelCall(input: { taskId: string; runId: string; scope: string; sequence: number; leaseVersion: number }): Promise<{ id: string }> {
    return this.db.transaction(async (tx) => {
      const [existing] = await tx.select({ id: modelCallContexts.id }).from(modelCallContexts).where(and(eq(modelCallContexts.taskId, input.taskId), eq(modelCallContexts.scope, input.scope), eq(modelCallContexts.sequence, input.sequence))).limit(1);
      if (existing) return existing;
      const [created] = await tx.insert(modelCallContexts).values({ ...input, invocationKey: `${input.scope}:${input.sequence}` }).onConflictDoNothing({ target: [modelCallContexts.taskId, modelCallContexts.scope, modelCallContexts.sequence] }).returning({ id: modelCallContexts.id });
      if (created) return created;
      const [raced] = await tx.select({ id: modelCallContexts.id }).from(modelCallContexts).where(and(eq(modelCallContexts.taskId, input.taskId), eq(modelCallContexts.scope, input.scope), eq(modelCallContexts.sequence, input.sequence))).limit(1);
      return raced!;
    });
  }

  async allocateModelCall(input: { taskId: string; runId: string; scope: string; invocationKey: string; leaseVersion: number }): Promise<{ id: string }> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.taskId}))`);
      const [existing] = await tx.select({ id: modelCallContexts.id }).from(modelCallContexts).where(and(eq(modelCallContexts.taskId, input.taskId), eq(modelCallContexts.invocationKey, input.invocationKey))).limit(1);
      if (existing) return existing;
      const [next] = await tx.select({ value: sql<string>`coalesce(max(${modelCallContexts.sequence}), 0) + 1` }).from(modelCallContexts).where(and(eq(modelCallContexts.taskId, input.taskId), eq(modelCallContexts.scope, input.scope)));
      const [created] = await tx.insert(modelCallContexts).values({ ...input, sequence: Number(next?.value ?? 1) }).returning({ id: modelCallContexts.id });
      return created!;
    });
  }

  async modelCallCursor(runId: string, scope: string): Promise<number> {
    const [checkpoint] = await this.db.select({ committedAt: checkpoints.committedAt }).from(checkpoints).where(eq(checkpoints.runId, runId)).orderBy(desc(checkpoints.version)).limit(1);
    if (!checkpoint) return 0;
    const [row] = await this.db.select({ value: sql<string>`coalesce(max(${modelCallContexts.sequence}), 0)` }).from(modelCallContexts).where(and(eq(modelCallContexts.runId, runId), eq(modelCallContexts.scope, scope), lte(modelCallContexts.createdAt, checkpoint.committedAt)));
    return Number(row?.value ?? 0);
  }

  async reserve(input: ReserveQuotaInput): Promise<{ id: string; balance: number }> {
    return this.db.transaction(async (tx) => {
      await this.lock(tx, input.userId);
      const existing = await this.byKey(tx, key(input.runId, input.modelCallId, "reserve"));
      if (existing) { await tx.update(quotaReservations).set({ taskId: input.taskId, leaseVersion: input.leaseVersion, heartbeatAt: new Date(), updatedAt: new Date() }).where(and(eq(quotaReservations.id, existing.id), eq(quotaReservations.status, "reserved"))); return { id: existing.id, balance: money(existing.balance) }; }
      const [user] = await tx.select({ budgetUsd: users.budgetUsd }).from(users).where(eq(users.id, input.userId)).limit(1).for("update");
      if (!user) throw new Error("user not found");
      const balance = await this.balance(input.userId, tx);
      const spent = await this.settledSpend(tx, input.userId);
      const budgetRemaining = user.budgetUsd === null ? null : Math.max(0, money(user.budgetUsd) - spent);
      quotaPolicy({ balanceUsd: balance, budgetRemainingUsd: budgetRemaining, estimatedCostUsd: input.estimatedCostUsd });
      const result = await this.append(input.userId, -input.estimatedCostUsd!, { ...input, operation: "reserve", idempotencyKey: key(input.runId, input.modelCallId, "reserve"), source: "platform_model", metadata: { estimatedCostUsd: input.estimatedCostUsd, model: input.model } }, tx);
      await tx.insert(quotaReservations).values({ id: result.id, userId: input.userId, projectId: input.projectId, runId: input.runId, modelCallId: input.modelCallId, taskId: input.taskId, leaseVersion: input.leaseVersion }).onConflictDoNothing();
      return result;
    });
  }

  async settle(input: SettleQuotaInput): Promise<{ id: string; balance: number }> {
    if (!Number.isFinite(input.actualCostUsd) || input.actualCostUsd < 0) throw new Error("actualCostUsd must be non-negative");
    return this.db.transaction(async (tx) => {
      await this.lock(tx, input.userId);
      const idempotencyKey = key(input.runId, input.modelCallId, "settle");
      const existing = await this.byKey(tx, idempotencyKey);
      if (existing) return { id: existing.id, balance: money(existing.balance) };
      const reservation = await this.reservation(tx, input.reservationId, input.userId);
      if (!reservation) throw new Error("reservation not found");
      const [released] = await tx.select({ id: quotaLedger.id }).from(quotaLedger).where(and(eq(quotaLedger.reservationId, reservation.id), eq(quotaLedger.operation, "release"))).limit(1);
      const estimated = -money(reservation.amount);
      const result = await this.append(input.userId, (released ? 0 : estimated) - input.actualCostUsd, { ...input, operation: "settle", idempotencyKey, source: "platform_model", metadata: { actualCostUsd: input.actualCostUsd, usageId: input.usageId, usage: input.usage ?? {}, model: input.model, credentialSource: input.credentialSource, priceSource: input.priceSource, latencyMs: input.latencyMs } }, tx);
      await tx.update(quotaReservations).set({ status: "settled", updatedAt: new Date() }).where(eq(quotaReservations.id, reservation.id));
      return result;
    });
  }

  async release(input: ReleaseQuotaInput): Promise<{ id: string; balance: number }> {
    return this.db.transaction(async (tx) => {
      await this.lock(tx, input.userId);
      const idempotencyKey = key(input.runId, input.modelCallId, "release");
      const existing = await this.byKey(tx, idempotencyKey);
      if (existing) return { id: existing.id, balance: money(existing.balance) };
      const reservation = await this.reservation(tx, input.reservationId, input.userId);
      if (!reservation) throw new Error("reservation not found");
      const terminal = await tx.select().from(quotaLedger).where(and(eq(quotaLedger.reservationId, reservation.id), inArray(quotaLedger.operation, ["settle", "release"]))).limit(1);
      if (terminal[0]) return { id: terminal[0].id, balance: money(terminal[0].balance) };
      const result = await this.append(input.userId, -money(reservation.amount), { ...input, operation: "release", idempotencyKey, source: "reconcile", metadata: { reason: input.reason, errorCategory: input.errorCategory, error: input.error?.slice(0, 500) } }, tx);
      await tx.update(quotaReservations).set({ status: "released", updatedAt: new Date() }).where(eq(quotaReservations.id, reservation.id));
      return result;
    });
  }

  async heartbeat(reservationId: string, taskId: string, leaseVersion: number): Promise<boolean> {
    const [updated] = await this.db.update(quotaReservations).set({ heartbeatAt: new Date(), updatedAt: new Date() }).where(and(eq(quotaReservations.id, reservationId), eq(quotaReservations.taskId, taskId), eq(quotaReservations.leaseVersion, leaseVersion), inArray(quotaReservations.status, ["reserved", "provider_started"]))).returning({ id: quotaReservations.id });
    return Boolean(updated);
  }

  async markProviderStarted(reservationId: string, taskId: string, leaseVersion: number): Promise<void> {
    const [updated] = await this.db.update(quotaReservations).set({ status: "provider_started", heartbeatAt: new Date(), updatedAt: new Date() }).where(and(eq(quotaReservations.id, reservationId), eq(quotaReservations.taskId, taskId), eq(quotaReservations.leaseVersion, leaseVersion), eq(quotaReservations.status, "reserved"))).returning({ id: quotaReservations.id });
    if (!updated) throw new Error("reservation could not persist provider_started");
  }

  async settleDurably(input: SettleQuotaInput & { credentialSource?: string; priceSource?: string; latencyMs?: number }): Promise<void> { await this.enqueueSettlementIntent(input); await this.processPendingOutbox(); }
  async releaseDurably(input: Parameters<DatabaseQuotaLedger["release"]>[0]): Promise<void> { await this.enqueueOutbox(input.reservationId, "release", input); await this.processPendingOutbox(); }

  async settleInterrupted(input: ReleaseQuotaInput & { error: string }): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [reservation] = await tx.select({ row: quotaReservations, ledger: quotaLedger }).from(quotaReservations).innerJoin(quotaLedger, eq(quotaLedger.id, quotaReservations.id)).where(eq(quotaReservations.id, input.reservationId)).limit(1).for("update");
      if (!reservation || reservation.row.status === "settled" || reservation.row.status === "released" || reservation.row.status === "needs_reconciliation") return;
      const estimatedCostUsd = -money(reservation.ledger.amount);
      await this.append(reservation.row.userId, 0, { ...input, operation: "estimate_settle", idempotencyKey: key(reservation.row.runId, reservation.row.modelCallId, "estimate_settle"), source: "platform_model_interrupted", metadata: { estimatedCostUsd, actualCostUsd: estimatedCostUsd, priceSource: "estimate", needsReconciliation: true, reason: input.reason, errorCategory: input.errorCategory, error: input.error.slice(0, 500) } }, tx);
      await tx.update(quotaReservations).set({ status: "needs_reconciliation", updatedAt: new Date() }).where(eq(quotaReservations.id, input.reservationId));
    });
  }

  async processPendingOutbox(limit = 100): Promise<number> {
    const now = new Date();
    const entries = await this.db.select().from(quotaSettlementOutbox).where(and(eq(quotaSettlementOutbox.status, "pending"), lte(quotaSettlementOutbox.nextAttemptAt, now))).orderBy(asc(quotaSettlementOutbox.createdAt)).limit(limit);
    let processed = 0;
    for (const entry of entries) {
      try {
        if (entry.action === "settle") await this.settle(entry.payload as SettleQuotaInput);
        else await this.release(entry.payload as Parameters<DatabaseQuotaLedger["release"]>[0]);
        await this.db.update(quotaSettlementOutbox).set({ status: "processed", processedAt: new Date(), attempts: entry.attempts + 1, lastError: null }).where(eq(quotaSettlementOutbox.id, entry.id));
        processed++;
      } catch (error) {
        const attempts = entry.attempts + 1;
        await this.db.update(quotaSettlementOutbox).set({ attempts, nextAttemptAt: new Date(Date.now() + Math.min(60_000, 250 * 2 ** Math.min(attempts, 8))), lastError: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500) }).where(eq(quotaSettlementOutbox.id, entry.id));
      }
    }
    return processed;
  }

  async reconcile(input: { olderThan: Date; now?: Date }): Promise<number> {
    const now = input.now ?? new Date();
    await this.processPendingOutbox();
    const reservations = await this.db.select({ reservation: quotaReservations }).from(quotaReservations).leftJoin(tasks, eq(tasks.id, quotaReservations.taskId)).where(and(inArray(quotaReservations.status, ["reserved", "provider_started", "provider_completed"]), lt(quotaReservations.heartbeatAt, input.olderThan), or(sql`${tasks.id} is null`, ne(tasks.leaseVersion, quotaReservations.leaseVersion), sql`${tasks.status} not in ('leased', 'running')`, sql`${tasks.leaseExpiresAt} is null`, sql`${tasks.leaseExpiresAt} <= ${now}`)));
    let released = 0;
    for (const { reservation } of reservations) {
      const terminalInput = { reservationId: reservation.id, userId: reservation.userId, projectId: reservation.projectId, runId: reservation.runId, modelCallId: reservation.modelCallId, taskId: reservation.taskId, leaseVersion: reservation.leaseVersion };
      if (reservation.status === "provider_completed") {
        const [intent] = await this.db.select({ id: quotaSettlementOutbox.id }).from(quotaSettlementOutbox).where(and(eq(quotaSettlementOutbox.reservationId, reservation.id), eq(quotaSettlementOutbox.action, "settle"))).limit(1);
        if (intent) continue;
        await this.settleInterrupted({ ...terminalInput, error: "actual usage intent missing after provider completion" });
      } else if (reservation.status === "provider_started") await this.settleInterrupted({ ...terminalInput, error: "provider call interrupted after lease loss" });
      else await this.releaseDurably(terminalInput);
      released++;
    }
    return released;
  }

  async reservationState(runId: string, modelCallId: string): Promise<"reserved" | "provider_started" | "provider_completed" | "needs_reconciliation" | "settled" | "released" | null> {
    const [row] = await this.db.select({ status: quotaReservations.status }).from(quotaReservations).where(and(eq(quotaReservations.runId, runId), eq(quotaReservations.modelCallId, modelCallId))).limit(1);
    return row?.status ?? null;
  }

  private async append(userId: string, amount: number, values: Record<string, unknown> & { operation: "credit" | "reserve" | "settle" | "estimate_settle" | "release"; idempotencyKey: string; source: string }, executor?: Executor): Promise<{ id: string; balance: number }> {
    const run = async (tx: Executor) => {
      await this.lock(tx, userId);
      const existing = await this.byKey(tx, values.idempotencyKey);
      if (existing) return { id: existing.id, balance: money(existing.balance) };
      const balance = await this.balance(userId, tx) + amount;
      const [row] = await tx.insert(quotaLedger).values({ userId, projectId: values.projectId as string | undefined, runId: values.runId as string | undefined, modelCallId: values.modelCallId as string | undefined, operation: values.operation, idempotencyKey: values.idempotencyKey, reservationId: values.reservationId as string | undefined, source: values.source, amount: String(amount), balance: String(balance), metadata: (values.metadata as Record<string, unknown>) ?? {} }).returning({ id: quotaLedger.id, balance: quotaLedger.balance });
      return { id: row!.id, balance: money(row!.balance) };
    };
    return executor ? run(executor) : this.db.transaction(run);
  }

  private lock(tx: Executor, userId: string) { return tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`); }
  private async byKey(tx: Executor, idempotencyKey: string) { const [row] = await tx.select().from(quotaLedger).where(eq(quotaLedger.idempotencyKey, idempotencyKey)).limit(1); return row; }
  private async reservation(tx: Executor, reservationId: string, userId: string) { const [row] = await tx.select().from(quotaLedger).where(and(eq(quotaLedger.id, reservationId), eq(quotaLedger.userId, userId), eq(quotaLedger.operation, "reserve"))).limit(1); return row; }
  private async settledSpend(tx: Executor, userId: string) { const [row] = await tx.select({ value: sql<string>`coalesce(sum(case when ${quotaLedger.operation} = 'settle' then coalesce((${quotaLedger.metadata}->>'actualCostUsd')::numeric, 0) when ${quotaLedger.operation} = 'estimate_settle' and not exists (select 1 from quota_ledger settled where settled.reservation_id = ${quotaLedger.reservationId} and settled.operation = 'settle') then coalesce((${quotaLedger.metadata}->>'estimatedCostUsd')::numeric, 0) else 0 end), 0)` }).from(quotaLedger).where(and(eq(quotaLedger.userId, userId), inArray(quotaLedger.operation, ["settle", "estimate_settle"]))); return money(row?.value); }
  private async enqueueOutbox(reservationId: string, action: "settle" | "release", payload: unknown) { await this.db.insert(quotaSettlementOutbox).values({ reservationId, action, payload }).onConflictDoNothing({ target: [quotaSettlementOutbox.reservationId, quotaSettlementOutbox.action] }); }
  private async enqueueSettlementIntent(input: SettleQuotaInput) { await this.db.transaction(async (tx) => { await tx.insert(quotaSettlementOutbox).values({ reservationId: input.reservationId, action: "settle", payload: input }).onConflictDoNothing({ target: [quotaSettlementOutbox.reservationId, quotaSettlementOutbox.action] }); await tx.update(quotaReservations).set({ status: "provider_completed", providerCompletedAt: new Date(), heartbeatAt: new Date(), updatedAt: new Date() }).where(and(eq(quotaReservations.id, input.reservationId), eq(quotaReservations.status, "provider_started"))); }); }
}

export const reserveQuota = (ledger: DatabaseQuotaLedger, input: ReserveQuotaInput) => ledger.reserve(input);
export const settleQuota = (ledger: DatabaseQuotaLedger, input: SettleQuotaInput) => ledger.settle(input);
export const releaseQuota = (ledger: DatabaseQuotaLedger, input: Parameters<DatabaseQuotaLedger["release"]>[0]) => ledger.release(input);

export function startQuotaMaintenance(ledger: Pick<DatabaseQuotaLedger, "reconcile">, options: { intervalMs: number; staleAfterMs: number }): () => void {
  const timer = setInterval(() => { void ledger.reconcile({ olderThan: new Date(Date.now() - options.staleAfterMs) }); }, options.intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
