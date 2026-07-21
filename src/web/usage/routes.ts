import type { FastifyPluginAsync } from "fastify";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../db/client.js";
import { auditEvents, platformModels, platformSettings, quotaLedger, users } from "../../db/schema/index.js";
import { normalizePlatformModelCapabilities } from "../../models/capabilities.js";
import { hasKnownPlatformPrice } from "../../quota/pricing.js";

const Settings = z.object({ concurrencyLimit: z.number().int().min(1).max(10_000) }).strict();

export function normalizeUsageSummary(row: { key: string; costUsd: string; inputTokens: string; outputTokens: string; latencyMs: string; credentialSources: string[]; priceSources: string[] }) {
  return { key: row.key, costUsd: Number(row.costUsd), inputTokens: Number(row.inputTokens), outputTokens: Number(row.outputTokens), latencyMs: Number(row.latencyMs), credentialSources: row.credentialSources, priceSources: row.priceSources, unknownPrice: row.priceSources.includes("unknown") };
}

export function platformModelAvailability(rows: Array<{ provider: string; model: string; status: "active" | "disabled"; capabilities: unknown; metadata: unknown; inputPrice?: unknown; outputPrice?: unknown }>) {
  return rows.filter((row) => row.status === "active").map((row) => {
    const unknownPrice = !hasKnownPlatformPrice(row.metadata, row.inputPrice ?? 0, row.outputPrice ?? 0);
    const caps = normalizePlatformModelCapabilities(row.capabilities);
    return { model: `${row.provider}/${row.model}`, available: !unknownPrice, unknownPrice, capabilities: caps, ...(unknownPrice ? { reason: "unknown_price" as const } : {}) };
  });
}

export async function setUserConcurrency(db: Database, userId: string, concurrencyLimit: number, requestId: string): Promise<{ kind: "updated" | "exceeds" | "missing"; maximum: number }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(4411472)`);
    const [setting] = await tx.select().from(platformSettings).where(eq(platformSettings.id, 1)).limit(1).for("update");
    const maximum = setting?.concurrencyLimit ?? 4;
    const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1).for("update");
    if (!user) return { kind: "missing", maximum };
    if (concurrencyLimit > maximum) return { kind: "exceeds", maximum };
    await tx.update(users).set({ concurrencyLimit, updatedAt: new Date() }).where(eq(users.id, userId));
    await tx.insert(auditEvents).values({ userId, action: "user.concurrency.update", targetType: "user", targetId: userId, result: "success", requestId, metadata: { concurrencyLimit } }).onConflictDoNothing();
    return { kind: "updated", maximum };
  });
}

export const usageRoutes: FastifyPluginAsync<{ db: Database }> = async (app, { db }) => {
  app.addHook("preHandler", app.authenticateRequest);
  app.get("/", async (request) => {
    const [user] = await db.select({ concurrencyLimit: users.concurrencyLimit, budgetUsd: users.budgetUsd }).from(users).where(eq(users.id, request.auth.userId)).limit(1);
    const [setting] = await db.select().from(platformSettings).where(eq(platformSettings.id, 1)).limit(1);
    const [latest] = await db.select({ balance: quotaLedger.balance }).from(quotaLedger).where(eq(quotaLedger.userId, request.auth.userId)).orderBy(desc(quotaLedger.createdAt)).limit(1);
    const configuredModels = await db.select({ provider: platformModels.provider, model: platformModels.model, status: platformModels.status, capabilities: platformModels.capabilities, metadata: platformModels.metadata, inputPrice: platformModels.inputPrice, outputPrice: platformModels.outputPrice }).from(platformModels);
    const fields = { key: sql<string>`''`, costUsd: sql<string>`sum(coalesce((${quotaLedger.metadata}->>'actualCostUsd')::numeric, 0))`, inputTokens: sql<string>`sum(coalesce((${quotaLedger.metadata}->'usage'->>'inputTokens')::bigint, 0))`, outputTokens: sql<string>`sum(coalesce((${quotaLedger.metadata}->'usage'->>'outputTokens')::bigint, 0))`, latencyMs: sql<string>`sum(coalesce((${quotaLedger.metadata}->>'latencyMs')::numeric, 0))`, credentialSources: sql<string[]>`array_agg(distinct coalesce(${quotaLedger.metadata}->>'credentialSource', 'unknown'))`, priceSources: sql<string[]>`array_agg(distinct coalesce(${quotaLedger.metadata}->>'priceSource', 'unknown'))` };
    const where = and(eq(quotaLedger.userId, request.auth.userId), eq(quotaLedger.operation, "settle"));
    const perAgentRows = await db.select({ ...fields, key: sql<string>`coalesce(${quotaLedger.metadata}->'usage'->>'agent', 'unknown')` }).from(quotaLedger).where(where).groupBy(sql`${quotaLedger.metadata}->'usage'->>'agent'`);
    const perModelRows = await db.select({ ...fields, key: sql<string>`coalesce(${quotaLedger.metadata}->>'model', 'unknown')` }).from(quotaLedger).where(where).groupBy(sql`${quotaLedger.metadata}->>'model'`);
    const convert = (row: typeof perAgentRows[number]) => normalizeUsageSummary(row);
    const perAgent = perAgentRows.map(convert), perModel = perModelRows.map(convert);
    return { settings: { concurrencyLimit: user?.concurrencyLimit ?? 1, adminMaxConcurrency: setting?.concurrencyLimit ?? 4, budgetUsd: user?.budgetUsd === null ? null : Number(user?.budgetUsd), balanceUsd: Number(latest?.balance ?? 0) }, perAgent, perModel, platformModels: platformModelAvailability(configuredModels) };
  });
  app.put("/settings", async (request, reply) => { const parsed = Settings.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: "Invalid settings" }); const result = await setUserConcurrency(db, request.auth.userId, parsed.data.concurrencyLimit, request.id); if (result.kind === "missing") return reply.code(404).send({ error: "User not found" }); if (result.kind === "exceeds") return reply.code(409).send({ error: "Concurrency exceeds administrator maximum", maximum: result.maximum }); return { concurrencyLimit: parsed.data.concurrencyLimit, maximum: result.maximum }; });
};
