import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { RequestAuth } from "../auth/plugin.js";
import type { AuditEventInput, AuditRepositoryLike } from "../audit/repository.js";
import type { ProjectMutationResult, ProjectRow } from "./repository.js";
import type { ProjectMutationService } from "./service.js";
import {
  ArchiveProjectSchema,
  CreateProjectSchema,
  ProjectIdParamsSchema,
  UpdateProjectSchema,
  type CreateProjectInput,
  type UpdateProjectInput,
} from "./schemas.js";

export type ProjectRecord = ProjectRow;

export interface ProjectRepositoryLike {
  list(auth: RequestAuth): Promise<ProjectRecord[]>;
  get(auth: RequestAuth, projectId: string): Promise<ProjectRecord | null>;
  create(auth: RequestAuth, input: CreateProjectInput): Promise<ProjectRecord>;
  update(auth: RequestAuth, projectId: string, input: UpdateProjectInput): Promise<ProjectMutationResult>;
  archive(auth: RequestAuth, projectId: string, version: number): Promise<ProjectMutationResult>;
}

interface ProjectRoutesOptions {
  repository: ProjectRepositoryLike;
  audit: AuditRepositoryLike;
  mutations: Pick<ProjectMutationService, "create" | "update" | "archive">;
}

const notFoundBody = { error: "Project not found" } as const;
const invalidBody = { error: "Invalid request" } as const;
const conflictBody = { error: "Version conflict" } as const;

async function auditMutation(
  audit: AuditRepositoryLike,
  request: FastifyRequest,
  event: Omit<AuditEventInput, "actorId" | "requestId">,
) {
  await audit.write({
    ...event,
    actorId: request.auth.userId,
    requestId: request.id,
  });
}

async function sendMutationResult(
  reply: FastifyReply,
  result: ProjectMutationResult,
) {
  if (result === "missing") return reply.code(404).send(notFoundBody);
  if (result === "conflict") return reply.code(409).send(conflictBody);
  return reply.code(200).send({ project: result });
}

export const projectRoutes: FastifyPluginAsync<ProjectRoutesOptions> = async (app, options) => {
  app.addHook("preHandler", app.authenticateRequest);

  app.get("/", async (request) => ({ projects: await options.repository.list(request.auth) }));

  app.get("/:projectId", async (request, reply) => {
    const params = ProjectIdParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(404).send(notFoundBody);
    const project = await options.repository.get(request.auth, params.data.projectId);
    return project ? { project } : reply.code(404).send(notFoundBody);
  });

  app.post("/", async (request, reply) => {
    const input = CreateProjectSchema.safeParse(request.body);
    if (!input.success) {
      await auditMutation(options.audit, request, {
        action: "project.create",
        targetId: null,
        result: "invalid",
      });
      return reply.code(400).send(invalidBody);
    }
    let project: ProjectRecord;
    try {
      project = await options.mutations.create(request.auth, input.data, request.id);
    } catch (error) {
      await auditMutation(options.audit, request, {
        action: "project.create",
        targetId: null,
        result: "error",
      });
      throw error;
    }
    return reply.code(201).send({ project });
  });

  app.patch("/:projectId", async (request, reply) => {
    const params = ProjectIdParamsSchema.safeParse(request.params);
    const input = UpdateProjectSchema.safeParse(request.body);
    if (!params.success || !input.success) {
      await auditMutation(options.audit, request, {
        action: "project.update",
        targetId: params.success ? params.data.projectId : null,
        result: "invalid",
      });
      return reply.code(400).send(invalidBody);
    }
    let result: ProjectMutationResult;
    try {
      result = await options.mutations.update(request.auth, params.data.projectId, input.data, request.id);
    } catch (error) {
      await auditMutation(options.audit, request, {
        action: "project.update",
        targetId: params.data.projectId,
        result: "error",
      });
      throw error;
    }
    return sendMutationResult(reply, result);
  });

  app.post("/:projectId/archive", async (request, reply) => {
    const params = ProjectIdParamsSchema.safeParse(request.params);
    const input = ArchiveProjectSchema.safeParse(request.body);
    if (!params.success || !input.success) {
      await auditMutation(options.audit, request, {
        action: "project.archive",
        targetId: params.success ? params.data.projectId : null,
        result: "invalid",
      });
      return reply.code(400).send(invalidBody);
    }
    let result: ProjectMutationResult;
    try {
      result = await options.mutations.archive(request.auth, params.data.projectId, input.data.version, request.id);
    } catch (error) {
      await auditMutation(options.audit, request, {
        action: "project.archive",
        targetId: params.data.projectId,
        result: "error",
      });
      throw error;
    }
    return sendMutationResult(reply, result);
  });
};
