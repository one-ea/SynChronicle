import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { RequestAuth } from "../auth/plugin.js";

const ProjectParams = z.object({ projectId: z.string().uuid() }).strict();
const RunParams = ProjectParams.extend({ runId: z.string().uuid() }).strict();

export interface WorkbenchProjection {
  id: string;
  userId: string;
  title: string;
  status: string;
  version: number;
  chapters: Array<{ id: string; runId: string; sequence: number; title: string; body: string; status: string; version: number }>;
  latestRun: { id: string; status: string; version: number; task: { id: string; status: string; leaseVersion: number } | null; checkpointVersion: number | null; waiting_for_durable_commit: boolean } | null;
  agents: Array<{ name: string; state: string; summary?: string; sequence?: number }>;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number; cost: string; byAgent: Array<{ agent: string; inputTokens: number; outputTokens: number; totalTokens: number; cost: string }> };
  pendingQuestion: { id: string; questions: Array<{ header: string; question: string; options: string[] }> } | null;
}

export interface WorkbenchRepositoryLike {
  get(auth: RequestAuth, projectId: string): Promise<WorkbenchProjection | null>;
  diagnose(auth: RequestAuth, projectId: string, runId: string): Promise<{ summary: string; cursor: number; checkpointVersion: number | null } | null>;
}

export const workbenchRoutes: FastifyPluginAsync<{ repository: WorkbenchRepositoryLike }> = async (app, options) => {
  app.addHook("preHandler", app.authenticateRequest);
  app.get("/:projectId/workbench", async (request, reply) => {
    const params = ProjectParams.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: "Project not found" });
    const workbench = await options.repository.get(request.auth, params.data.projectId);
    return workbench ? { workbench } : reply.code(404).send({ error: "Project not found" });
  });
  app.get("/:projectId/runs/:runId/diagnostics", async (request, reply) => {
    const params = RunParams.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: "Run not found" });
    const diagnostics = await options.repository.diagnose(request.auth, params.data.projectId, params.data.runId);
    return diagnostics ? { diagnostics } : reply.code(404).send({ error: "Run not found" });
  });
};
