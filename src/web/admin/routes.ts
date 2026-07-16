import type { FastifyPluginAsync } from "fastify";
import { eq, gt } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../db/client.js";
import { auditEvents, platformModels, platformSettings, users } from "../../db/schema/index.js";
import { DatabaseQuotaLedger } from "../../quota/ledger.js";
import type { RequestAuth } from "../auth/plugin.js";

const ModelInput = z.object({ provider: z.string().trim().min(1).max(100), model: z.string().trim().min(1).max(200), status: z.enum(["active", "disabled"]), inputPrice: z.number().finite().nonnegative(), outputPrice: z.number().finite().nonnegative(), credentialReference: z.string().trim().min(1).max(200), metadata: z.record(z.unknown()).optional() }).strict();
const ModelUpdate = ModelInput.partial().strict();
const ModelParams = z.object({ modelId: z.string().uuid() }).strict();
const BalanceInput = z.object({ userId: z.string().uuid(), amountUsd: z.number().finite(), reason: z.string().trim().min(1).max(200) }).strict();
const ConcurrencyInput = z.object({ concurrencyLimit: z.number().int().min(1).max(10_000) }).strict();

export interface AdminRoutesRepository {
  listModels(): Promise<unknown[]>;
  createModel(auth: RequestAuth, input: z.infer<typeof ModelInput>, requestId: string): Promise<unknown>;
  updateModel(auth: RequestAuth, modelId: string, input: z.infer<typeof ModelUpdate>, requestId: string): Promise<unknown | null>;
  setBalance(auth: RequestAuth, input: z.infer<typeof BalanceInput>, requestId: string): Promise<unknown>;
  setPlatformConcurrency(auth: RequestAuth, value: number, requestId: string): Promise<unknown>;
}

function publicModel(value: unknown) {
  if (!value || typeof value !== "object") return value;
  const { credentialReference: _credentialReference, ...model } = value as Record<string, unknown>;
  return { ...model, credentialSource: model.credentialSource ?? "environment" };
}

export const adminRoutes: FastifyPluginAsync<{ repository: AdminRoutesRepository }> = async (app, options) => {
  app.addHook("preHandler", app.authenticateRequest);
  app.addHook("preHandler", async (request, reply) => { if (request.auth.role !== "admin") await reply.code(403).send({ error: "Forbidden" }); });
  app.get("/models", async () => ({ models: (await options.repository.listModels()).map(publicModel) }));
  app.post("/models", async (request, reply) => { const parsed = ModelInput.safeParse(request.body); return parsed.success ? reply.code(201).send({ model: publicModel(await options.repository.createModel(request.auth, parsed.data, request.id)) }) : reply.code(400).send({ error: "Invalid model" }); });
  app.patch("/models/:modelId", async (request, reply) => { const params = ModelParams.safeParse(request.params), parsed = ModelUpdate.safeParse(request.body); if (!params.success || !parsed.success) return reply.code(400).send({ error: "Invalid model" }); const model = await options.repository.updateModel(request.auth, params.data.modelId, parsed.data, request.id); return model ? { model: publicModel(model) } : reply.code(404).send({ error: "Model not found" }); });
  app.post("/balance", async (request, reply) => { const parsed = BalanceInput.safeParse(request.body); return parsed.success ? { balance: await options.repository.setBalance(request.auth, parsed.data, request.id) } : reply.code(400).send({ error: "Invalid balance adjustment" }); });
  app.put("/concurrency", async (request, reply) => { const parsed = ConcurrencyInput.safeParse(request.body); return parsed.success ? { settings: await options.repository.setPlatformConcurrency(request.auth, parsed.data.concurrencyLimit, request.id) } : reply.code(400).send({ error: "Invalid concurrency" }); });
};

export class DatabaseAdminRepository implements AdminRoutesRepository {
  private readonly ledger: DatabaseQuotaLedger;
  constructor(private readonly db: Database) { this.ledger = new DatabaseQuotaLedger(db); }
  listModels() { return this.db.select().from(platformModels); }
  async createModel(auth: RequestAuth, input: z.infer<typeof ModelInput>, requestId: string) { return this.db.transaction(async (tx) => { const [model] = await tx.insert(platformModels).values({ ...input, inputPrice: String(input.inputPrice), outputPrice: String(input.outputPrice) }).returning(); await tx.insert(auditEvents).values({ userId: auth.userId, action: "platform_model.create", targetType: "platform_model", targetId: model!.id, result: "success", requestId, metadata: { provider: input.provider, model: input.model } }); return model!; }); }
  async updateModel(auth: RequestAuth, modelId: string, input: z.infer<typeof ModelUpdate>, requestId: string) { return this.db.transaction(async (tx) => { const { inputPrice, outputPrice, ...rest } = input; const values = { ...rest, ...(inputPrice === undefined ? {} : { inputPrice: String(inputPrice) }), ...(outputPrice === undefined ? {} : { outputPrice: String(outputPrice) }), updatedAt: new Date() }; const [model] = await tx.update(platformModels).set(values).where(eq(platformModels.id, modelId)).returning(); if (!model) return null; await tx.insert(auditEvents).values({ userId: auth.userId, action: "platform_model.update", targetType: "platform_model", targetId: modelId, result: "success", requestId, metadata: { fields: Object.keys(input) } }); return model; }); }
  async setBalance(auth: RequestAuth, input: z.infer<typeof BalanceInput>, requestId: string) { const result = await this.ledger.credit(input.userId, input.amountUsd, `admin:${requestId}:balance`, "admin_adjustment"); await this.db.insert(auditEvents).values({ userId: auth.userId, action: "quota.balance.adjust", targetType: "user", targetId: input.userId, result: "success", requestId, metadata: { amountUsd: input.amountUsd, reason: input.reason } }); return { balanceUsd: result.balance }; }
  async setPlatformConcurrency(auth: RequestAuth, value: number, requestId: string) { return this.db.transaction(async (tx) => { await tx.insert(platformSettings).values({ id: 1, concurrencyLimit: value, updatedAt: new Date() }).onConflictDoUpdate({ target: platformSettings.id, set: { concurrencyLimit: value, updatedAt: new Date() } }); await tx.update(users).set({ concurrencyLimit: value }).where(gt(users.concurrencyLimit, value)); await tx.insert(auditEvents).values({ userId: auth.userId, action: "platform.concurrency.update", targetType: "platform", targetId: "1", result: "success", requestId, metadata: { concurrencyLimit: value } }); return { platformConcurrency: value }; }); }
}
