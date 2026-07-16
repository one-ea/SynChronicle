import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { quotaLedger, users } from "../db/schema/index.js";
import { QuotaError, quotaPolicy } from "./policy.js";

type Executor = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface ReserveQuotaInput {
  userId: string;
  projectId: string;
  runId: string;
  modelCallId: string;
  estimatedCostUsd: number | null;
  model?: string;
}

export interface SettleQuotaInput extends Omit<ReserveQuotaInput, "estimatedCostUsd"> {
  reservationId: string;
  actualCostUsd: number;
  usageId: string;
  usage?: Record<string, unknown>;
}

const key = (runId: string, modelCallId: string, operation: string) => `${runId}:${modelCallId}:${operation}`;
const money = (value: string | number | null | undefined) => Number(value ?? 0);

export class DatabaseQuotaLedger {
  constructor(private readonly db: Database) {}

  async balance(userId: string, executor: Database | Executor = this.db): Promise<number> {
    const [row] = await executor.select({ balance: quotaLedger.balance }).from(quotaLedger).where(eq(quotaLedger.userId, userId)).orderBy(desc(quotaLedger.createdAt), desc(quotaLedger.id)).limit(1);
    return money(row?.balance);
  }

  async credit(userId: string, amountUsd: number, idempotencyKey: string, source = "admin"): Promise<{ id: string; balance: number }> {
    if (!Number.isFinite(amountUsd)) throw new Error("amountUsd must be finite");
    return this.append(userId, amountUsd, { operation: "credit", idempotencyKey, source });
  }

  async reserve(input: ReserveQuotaInput): Promise<{ id: string; balance: number }> {
    return this.db.transaction(async (tx) => {
      await this.lock(tx, input.userId);
      const existing = await this.byKey(tx, key(input.runId, input.modelCallId, "reserve"));
      if (existing) return { id: existing.id, balance: money(existing.balance) };
      const [user] = await tx.select({ budgetUsd: users.budgetUsd }).from(users).where(eq(users.id, input.userId)).limit(1).for("update");
      if (!user) throw new Error("user not found");
      const balance = await this.balance(input.userId, tx);
      const spent = await this.settledSpend(tx, input.userId);
      const budgetRemaining = user.budgetUsd === null ? null : Math.max(0, money(user.budgetUsd) - spent);
      quotaPolicy({ balanceUsd: balance, budgetRemainingUsd: budgetRemaining, estimatedCostUsd: input.estimatedCostUsd });
      return this.append(input.userId, -input.estimatedCostUsd!, { ...input, operation: "reserve", idempotencyKey: key(input.runId, input.modelCallId, "reserve"), source: "platform_model", metadata: { estimatedCostUsd: input.estimatedCostUsd, model: input.model } }, tx);
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
      const terminal = await tx.select({ id: quotaLedger.id }).from(quotaLedger).where(and(eq(quotaLedger.reservationId, reservation.id), inArray(quotaLedger.operation, ["settle", "release"]))).limit(1);
      if (terminal.length) throw new QuotaError("INSUFFICIENT_BALANCE");
      const estimated = -money(reservation.amount);
      return this.append(input.userId, estimated - input.actualCostUsd, { ...input, operation: "settle", idempotencyKey, source: "platform_model", metadata: { actualCostUsd: input.actualCostUsd, usageId: input.usageId, usage: input.usage ?? {}, model: input.model } }, tx);
    });
  }

  async release(input: Omit<SettleQuotaInput, "actualCostUsd" | "usageId" | "usage">): Promise<{ id: string; balance: number }> {
    return this.db.transaction(async (tx) => {
      await this.lock(tx, input.userId);
      const idempotencyKey = key(input.runId, input.modelCallId, "release");
      const existing = await this.byKey(tx, idempotencyKey);
      if (existing) return { id: existing.id, balance: money(existing.balance) };
      const reservation = await this.reservation(tx, input.reservationId, input.userId);
      if (!reservation) throw new Error("reservation not found");
      const terminal = await tx.select().from(quotaLedger).where(and(eq(quotaLedger.reservationId, reservation.id), inArray(quotaLedger.operation, ["settle", "release"]))).limit(1);
      if (terminal[0]) return { id: terminal[0].id, balance: money(terminal[0].balance) };
      return this.append(input.userId, -money(reservation.amount), { ...input, operation: "release", idempotencyKey, source: "reconcile" }, tx);
    });
  }

  async reconcile(input: { olderThan: Date }): Promise<number> {
    const reservations = await this.db.select().from(quotaLedger).where(and(eq(quotaLedger.operation, "reserve"), lt(quotaLedger.createdAt, input.olderThan)));
    let released = 0;
    for (const reservation of reservations) {
      if (!reservation.runId || !reservation.modelCallId || !reservation.projectId) continue;
      const terminal = await this.db.select({ id: quotaLedger.id }).from(quotaLedger).where(and(eq(quotaLedger.reservationId, reservation.id), inArray(quotaLedger.operation, ["settle", "release"]))).limit(1);
      if (terminal.length) continue;
      await this.release({ reservationId: reservation.id, userId: reservation.userId, projectId: reservation.projectId, runId: reservation.runId, modelCallId: reservation.modelCallId });
      released++;
    }
    return released;
  }

  async reservationState(runId: string, modelCallId: string): Promise<"reserved" | "settled" | "released" | null> {
    const rows = await this.db.select({ operation: quotaLedger.operation }).from(quotaLedger).where(and(eq(quotaLedger.runId, runId), eq(quotaLedger.modelCallId, modelCallId))).orderBy(desc(quotaLedger.createdAt));
    const operation = rows[0]?.operation;
    return operation === "reserve" ? "reserved" : operation === "settle" ? "settled" : operation === "release" ? "released" : null;
  }

  private async append(userId: string, amount: number, values: Record<string, unknown> & { operation: "credit" | "reserve" | "settle" | "release"; idempotencyKey: string; source: string }, executor?: Executor): Promise<{ id: string; balance: number }> {
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
  private async settledSpend(tx: Executor, userId: string) { const [row] = await tx.select({ value: sql<string>`coalesce(sum((metadata->>'actualCostUsd')::numeric), 0)` }).from(quotaLedger).where(and(eq(quotaLedger.userId, userId), eq(quotaLedger.operation, "settle"))); return money(row?.value); }
}

export const reserveQuota = (ledger: DatabaseQuotaLedger, input: ReserveQuotaInput) => ledger.reserve(input);
export const settleQuota = (ledger: DatabaseQuotaLedger, input: SettleQuotaInput) => ledger.settle(input);
export const releaseQuota = (ledger: DatabaseQuotaLedger, input: Parameters<DatabaseQuotaLedger["release"]>[0]) => ledger.release(input);
