import type { FastifyPluginAsync } from "fastify";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../db/client.js";
import { platformSettings, quotaLedger, users } from "../../db/schema/index.js";

const Settings = z.object({ concurrencyLimit: z.number().int().min(1).max(10_000) }).strict();

export const usageRoutes: FastifyPluginAsync<{ db: Database }> = async (app, { db }) => {
  app.addHook("preHandler", app.authenticateRequest);
  app.get("/", async (request) => {
    const [user] = await db.select({ concurrencyLimit: users.concurrencyLimit, budgetUsd: users.budgetUsd }).from(users).where(eq(users.id, request.auth.userId)).limit(1);
    const [setting] = await db.select().from(platformSettings).where(eq(platformSettings.id, 1)).limit(1);
    const [latest] = await db.select({ balance: quotaLedger.balance }).from(quotaLedger).where(eq(quotaLedger.userId, request.auth.userId)).orderBy(desc(quotaLedger.createdAt)).limit(1);
    const usage = await db.select({ agent: sql<string>`coalesce(${quotaLedger.metadata}->'usage'->>'agent', 'unknown')`, model: sql<string>`coalesce(${quotaLedger.metadata}->>'model', 'unknown')`, costUsd: sql<string>`sum(coalesce((${quotaLedger.metadata}->>'actualCostUsd')::numeric, 0))`, inputTokens: sql<number>`sum(coalesce((${quotaLedger.metadata}->'usage'->>'inputTokens')::bigint, 0))`, outputTokens: sql<number>`sum(coalesce((${quotaLedger.metadata}->'usage'->>'outputTokens')::bigint, 0))` }).from(quotaLedger).where(and(eq(quotaLedger.userId, request.auth.userId), eq(quotaLedger.operation, "settle"))).groupBy(sql`${quotaLedger.metadata}->'usage'->>'agent'`, sql`${quotaLedger.metadata}->>'model'`);
    return { settings: { concurrencyLimit: user?.concurrencyLimit ?? 1, adminMaxConcurrency: setting?.concurrencyLimit ?? 4, budgetUsd: user?.budgetUsd === null ? null : Number(user?.budgetUsd), balanceUsd: Number(latest?.balance ?? 0) }, usage };
  });
  app.put("/settings", async (request, reply) => { const parsed = Settings.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: "Invalid settings" }); const [setting] = await db.select().from(platformSettings).where(eq(platformSettings.id, 1)).limit(1); const maximum = setting?.concurrencyLimit ?? 4; if (parsed.data.concurrencyLimit > maximum) return reply.code(409).send({ error: "Concurrency exceeds administrator maximum", maximum }); await db.transaction(async (tx) => { await tx.update(users).set({ concurrencyLimit: parsed.data.concurrencyLimit, updatedAt: new Date() }).where(eq(users.id, request.auth.userId)); await tx.insert((await import("../../db/schema/index.js")).auditEvents).values({ userId: request.auth.userId, action: "user.concurrency.update", targetType: "user", targetId: request.auth.userId, result: "success", requestId: request.id, metadata: { concurrencyLimit: parsed.data.concurrencyLimit } }); }); return { concurrencyLimit: parsed.data.concurrencyLimit, maximum }; });
};
