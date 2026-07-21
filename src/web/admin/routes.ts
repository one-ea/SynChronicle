import type { FastifyPluginAsync } from "fastify";
import { and, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../db/client.js";
import { auditEvents, platformModels, platformSettings, users } from "../../db/schema/index.js";
import { DatabaseQuotaLedger } from "../../quota/ledger.js";
import type { RequestAuth } from "../auth/plugin.js";
import { platformCredentialSource } from "../../quota/platformCredential.js";
import { normalizePlatformModelCapabilities, PlatformModelCapabilitiesSchema } from "../../models/capabilities.js";

const CredentialReference = z.string().refine((value) => { try { platformCredentialSource(value); return true; } catch { return false; } });
const CapabilitiesInput = z.record(z.unknown()).optional();
const ModelBase = z.object({ provider: z.string().trim().min(1).max(100), model: z.string().trim().min(1).max(200), status: z.enum(["active", "disabled"]), inputPrice: z.number().finite().nonnegative(), outputPrice: z.number().finite().nonnegative(), credentialReference: CredentialReference, capabilities: CapabilitiesInput, metadata: z.record(z.unknown()).optional() }).strict();
const ModelInput = ModelBase.superRefine((data, ctx) => { if (data.capabilities !== undefined) { const result = PlatformModelCapabilitiesSchema.safeParse(data.capabilities); if (!result.success) { for (const issue of result.error.issues) { ctx.addIssue({ ...issue, path: ["capabilities", ...issue.path] }); } } } });
const ModelUpdate = ModelBase.partial();
const ModelParams = z.object({ modelId: z.string().uuid() }).strict();
const BalanceInput = z.object({ userId: z.string().uuid(), amountUsd: z.number().finite(), reason: z.string().trim().min(1).max(200) }).strict();
const ConcurrencyInput = z.object({ concurrencyLimit: z.number().int().min(1).max(10_000) }).strict();

export interface AdminRoutesRepository {
  listModels(): Promise<unknown[]>;
  createModel(auth: RequestAuth, input: z.infer<typeof ModelInput>, requestId: string): Promise<unknown>;
  updateModel(auth: RequestAuth, modelId: string, input: z.infer<typeof ModelUpdate>, requestId: string): Promise<unknown | null>;
  deleteModel(auth: RequestAuth, modelId: string, requestId: string): Promise<"deleted" | "active" | "missing">;
  setBalance(auth: RequestAuth, input: z.infer<typeof BalanceInput>, requestId: string): Promise<unknown>;
  setPlatformConcurrency(auth: RequestAuth, value: number, requestId: string): Promise<unknown>;
}

function publicModel(value: unknown) {
  if (!value || typeof value !== "object") return value;
  const { credentialReference: _credentialReference, ...model } = value as Record<string, unknown>;
  return { ...model, credentialSource: typeof value === "object" && value && "credentialReference" in value ? platformCredentialSource(String((value as Record<string, unknown>).credentialReference)) : model.credentialSource, capabilities: normalizePlatformModelCapabilities((value as Record<string, unknown>).capabilities) };
}

export const adminRoutes: FastifyPluginAsync<{ repository: AdminRoutesRepository }> = async (app, options) => {
  app.get("/models", async () => ({ models: (await options.repository.listModels()).map(publicModel) }));
  app.post("/models", async (request, reply) => { const parsed = ModelInput.safeParse(request.body); return parsed.success ? reply.code(201).send({ model: publicModel(await options.repository.createModel(request.auth, parsed.data, request.id)) }) : reply.code(400).send({ error: "Invalid model" }); });
  app.patch("/models/:modelId", async (request, reply) => { const params = ModelParams.safeParse(request.params), parsed = ModelUpdate.safeParse(request.body); if (!params.success || !parsed.success) return reply.code(400).send({ error: "Invalid model" }); const model = await options.repository.updateModel(request.auth, params.data.modelId, parsed.data, request.id); return model ? { model: publicModel(model) } : reply.code(404).send({ error: "Model not found" }); });
  app.delete("/models/:modelId", async (request, reply) => { const params = ModelParams.safeParse(request.params); if (!params.success) return reply.code(400).send({ error: "Invalid model" }); const result = await options.repository.deleteModel(request.auth, params.data.modelId, request.id); if (result === "active") return reply.code(409).send({ error: "Disable model before deletion" }); if (result === "missing") return reply.code(404).send({ error: "Model not found" }); return reply.code(204).send(); });
  app.post("/balance", async (request, reply) => { const parsed = BalanceInput.safeParse(request.body); return parsed.success ? { balance: await options.repository.setBalance(request.auth, parsed.data, request.id) } : reply.code(400).send({ error: "Invalid balance adjustment" }); });
  app.put("/concurrency", async (request, reply) => { const parsed = ConcurrencyInput.safeParse(request.body); return parsed.success ? { settings: await options.repository.setPlatformConcurrency(request.auth, parsed.data.concurrencyLimit, request.id) } : reply.code(400).send({ error: "Invalid concurrency" }); });
};

export class DatabaseAdminRepository implements AdminRoutesRepository {
  private readonly ledger: DatabaseQuotaLedger;
  constructor(private readonly db: Database) { this.ledger = new DatabaseQuotaLedger(db); }
  listModels() { return this.db.select().from(platformModels); }
  async createModel(auth: RequestAuth, input: z.infer<typeof ModelInput>, requestId: string) { return this.db.transaction(async (tx) => { const metadata = { ...(input.metadata ?? {}), ...(platformCredentialSource(input.credentialReference) === "encrypted" ? { credentialOwnerId: auth.userId } : {}) }; const normalizedCaps = normalizePlatformModelCapabilities(input.capabilities); const [model] = await tx.insert(platformModels).values({ ...input, capabilities: normalizedCaps, metadata, inputPrice: String(input.inputPrice), outputPrice: String(input.outputPrice) }).returning(); await tx.insert(auditEvents).values({ userId: auth.userId, action: "platform_model.create", targetType: "platform_model", targetId: model!.id, result: "success", requestId, metadata: { provider: input.provider, model: input.model, credentialSource: platformCredentialSource(input.credentialReference) } }); return model!; }); }
  async updateModel(auth: RequestAuth, modelId: string, input: z.infer<typeof ModelUpdate>, requestId: string) { return this.db.transaction(async (tx) => { const { inputPrice, outputPrice, capabilities: capsInput, ...rest } = input; const metadata = input.credentialReference && platformCredentialSource(input.credentialReference) === "encrypted" ? { ...(input.metadata ?? {}), credentialOwnerId: auth.userId } : input.metadata; const values = { ...rest, ...(capsInput !== undefined ? { capabilities: normalizePlatformModelCapabilities(capsInput) } : {}), ...(metadata === undefined ? {} : { metadata }), ...(inputPrice === undefined ? {} : { inputPrice: String(inputPrice) }), ...(outputPrice === undefined ? {} : { outputPrice: String(outputPrice) }), updatedAt: new Date() }; const [model] = await tx.update(platformModels).set(values).where(eq(platformModels.id, modelId)).returning(); if (!model) return null; await tx.insert(auditEvents).values({ userId: auth.userId, action: "platform_model.update", targetType: "platform_model", targetId: modelId, result: "success", requestId, metadata: { fields: Object.keys(input) } }).onConflictDoNothing(); return model; }); }
  async deleteModel(auth: RequestAuth, modelId: string, requestId: string): Promise<"deleted" | "active" | "missing"> { return this.db.transaction(async (tx) => { const [model] = await tx.select({ status: platformModels.status }).from(platformModels).where(eq(platformModels.id, modelId)).limit(1).for("update"); if (!model) return "missing"; if (model.status === "active") return "active"; await tx.delete(platformModels).where(and(eq(platformModels.id, modelId), eq(platformModels.status, "disabled"))); await tx.insert(auditEvents).values({ userId: auth.userId, action: "platform_model.delete", targetType: "platform_model", targetId: modelId, result: "success", requestId }).onConflictDoNothing(); return "deleted"; }); }
  async setBalance(auth: RequestAuth, input: z.infer<typeof BalanceInput>, requestId: string) { return this.db.transaction(async (tx) => { const result = await this.ledger.credit(input.userId, input.amountUsd, `admin:${requestId}:balance`, "admin_adjustment", tx); await tx.insert(auditEvents).values({ userId: auth.userId, action: "quota.balance.adjust", targetType: "user", targetId: input.userId, result: "success", requestId, metadata: { amountUsd: input.amountUsd, reason: input.reason } }).onConflictDoNothing(); return { balanceUsd: result.balance }; }); }
  async setPlatformConcurrency(auth: RequestAuth, value: number, requestId: string) { return this.db.transaction(async (tx) => { await tx.execute(sql`select pg_advisory_xact_lock(4411472)`); await tx.insert(platformSettings).values({ id: 1, concurrencyLimit: value, updatedAt: new Date() }).onConflictDoUpdate({ target: platformSettings.id, set: { concurrencyLimit: value, updatedAt: new Date() } }); await tx.update(users).set({ concurrencyLimit: value }).where(gt(users.concurrencyLimit, value)); await tx.insert(auditEvents).values({ userId: auth.userId, action: "platform.concurrency.update", targetType: "platform", targetId: "1", result: "success", requestId, metadata: { concurrencyLimit: value } }).onConflictDoNothing(); return { platformConcurrency: value }; }); }
}
