import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { ModelSetInputSchema } from "./modelConfig.js";
import type { CredentialMetadata, CredentialSecret } from "../../credentials/service.js";

const Params = z.object({ modelSetId: z.string().uuid() }).strict();
const CredentialParams = z.object({ credentialId: z.string().uuid() }).strict();
const CreateCredential = z.object({ provider: z.string().trim().min(1).max(100), label: z.string().trim().min(1).max(100).optional(), apiKey: z.string().min(1).max(16_384), baseUrl: z.string().url().max(2048).optional() }).strict();
const ReplaceCredential = z.object({ apiKey: z.string().min(1).max(16_384), baseUrl: z.string().url().max(2048).optional() }).strict();

export interface ModelConfigurationRoutesRepository {
  list(auth: import("../auth/plugin.js").RequestAuth): Promise<unknown[]>;
  create(auth: import("../auth/plugin.js").RequestAuth, input: unknown): Promise<unknown>;
  revise(auth: import("../auth/plugin.js").RequestAuth, modelSetId: string, input: unknown): Promise<unknown | null>;
  activate(auth: import("../auth/plugin.js").RequestAuth, modelSetId: string): Promise<boolean>;
}

export interface CredentialRoutesService {
  create(userId: string, input: CredentialSecret & { provider: string; label?: string }, requestId: string): Promise<CredentialMetadata | unknown>;
  list(userId: string): Promise<CredentialMetadata[] | unknown[]>;
  replace(userId: string, id: string, input: CredentialSecret, requestId: string): Promise<CredentialMetadata | null | unknown>;
  disable(userId: string, id: string, requestId: string): Promise<CredentialMetadata | null | unknown>;
  revoke(userId: string, id: string, requestId: string): Promise<CredentialMetadata | null | unknown>;
}

export const modelConfigurationRoutes: FastifyPluginAsync<{ repository: ModelConfigurationRoutesRepository; credentials?: CredentialRoutesService; consumeCredentialMutation?: (userId: string) => boolean }> = async (app, options) => {
  app.addHook("preHandler", app.authenticateRequest);
  if (options.credentials) {
    app.get("/credentials", async (request) => ({ credentials: await options.credentials!.list(request.auth.userId) }));
    app.post("/credentials", async (request, reply) => {
      if (options.consumeCredentialMutation && !options.consumeCredentialMutation(request.auth.userId)) return reply.code(429).send({ error: "Too Many Requests" });
      const parsed = CreateCredential.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid credential" });
      return reply.code(201).send({ credential: await options.credentials!.create(request.auth.userId, parsed.data, request.id) });
    });
    app.put("/credentials/:credentialId", async (request, reply) => {
      if (options.consumeCredentialMutation && !options.consumeCredentialMutation(request.auth.userId)) return reply.code(429).send({ error: "Too Many Requests" });
      const params = CredentialParams.safeParse(request.params), parsed = ReplaceCredential.safeParse(request.body);
      if (!params.success || !parsed.success) return reply.code(400).send({ error: "Invalid credential" });
      const credential = await options.credentials!.replace(request.auth.userId, params.data.credentialId, parsed.data, request.id);
      return credential ? { credential } : reply.code(404).send({ error: "Credential not found" });
    });
    for (const action of ["disable", "revoke"] as const) app.post(`/credentials/:credentialId/${action}`, async (request, reply) => {
      if (options.consumeCredentialMutation && !options.consumeCredentialMutation(request.auth.userId)) return reply.code(429).send({ error: "Too Many Requests" });
      const params = CredentialParams.safeParse(request.params);
      if (!params.success) return reply.code(404).send({ error: "Credential not found" });
      const credential = await options.credentials![action](request.auth.userId, params.data.credentialId, request.id);
      return credential ? { credential } : reply.code(404).send({ error: "Credential not found" });
    });
  }
  app.get("/model-sets", async (request) => ({ modelSets: await options.repository.list(request.auth) }));
  app.post("/model-sets", async (request, reply) => {
    if (!ModelSetInputSchema.safeParse(request.body).success) return reply.code(400).send({ error: "Invalid model configuration" });
    try { return reply.code(201).send({ modelSet: await options.repository.create(request.auth, request.body) }); } catch { return reply.code(400).send({ error: "Invalid model configuration" }); }
  });
  app.put("/model-sets/:modelSetId", async (request, reply) => {
    const params = Params.safeParse(request.params);
    if (!params.success || !ModelSetInputSchema.safeParse(request.body).success) return reply.code(400).send({ error: "Invalid model configuration" });
    try { const row = await options.repository.revise(request.auth, params.data.modelSetId, request.body); return row ? { modelSet: row } : reply.code(404).send({ error: "Model set not found" }); } catch { return reply.code(400).send({ error: "Invalid model configuration" }); }
  });
  app.post("/model-sets/:modelSetId/activate", async (request, reply) => {
    const params = Params.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: "Model set not found" });
    return await options.repository.activate(request.auth, params.data.modelSetId) ? { status: "active" } : reply.code(404).send({ error: "Model set not found" });
  });
};
