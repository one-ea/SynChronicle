import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { ModelSetInputSchema } from "./modelConfig.js";

const Params = z.object({ modelSetId: z.string().uuid() }).strict();

export interface ModelConfigurationRoutesRepository {
  list(auth: import("../auth/plugin.js").RequestAuth): Promise<unknown[]>;
  create(auth: import("../auth/plugin.js").RequestAuth, input: unknown): Promise<unknown>;
  revise(auth: import("../auth/plugin.js").RequestAuth, modelSetId: string, input: unknown): Promise<unknown | null>;
  activate(auth: import("../auth/plugin.js").RequestAuth, modelSetId: string): Promise<boolean>;
}

export const modelConfigurationRoutes: FastifyPluginAsync<{ repository: ModelConfigurationRoutesRepository }> = async (app, options) => {
  app.addHook("preHandler", app.authenticateRequest);
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
