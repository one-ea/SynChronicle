import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { RequestAuth } from "../auth/plugin.js";
import { ParametersSchema } from "../providers/modelConfig.js";
import { LEGACY_COMMAND_ID_PREFIX, type EnqueueRunInput, type RunCommand, type RunCommandResult, type RunRow } from "../../scheduler/types.js";

const ParamsSchema = z.object({ projectId: z.string().min(1), runId: z.string().uuid().optional() }).strict();
const CommandParamsSchema = z.object({ projectId: z.string().min(1), runId: z.string().uuid(), commandId: z.string().min(1).max(200) }).strict();
const StartSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(200),
  type: z.enum(["write", "review", "maintenance"]).optional(),
  priority: z.number().int().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  budgetSnapshot: z.record(z.string(), z.unknown()).optional(),
  configuration: z.object({
    modelSetId: z.string().uuid(),
    version: z.number().int().positive(),
    agents: z.record(z.string(), z.object({ provider: z.string(), model: z.string(), credentialId: z.string().uuid().optional(), parameters: z.record(z.string(), z.unknown()).optional() }).strict()),
  }).strict().optional(),
}).strict();
const SteerSchema = z.object({
  commandId: z.string().trim().min(1).max(200).refine(
    (value) => !value.startsWith(LEGACY_COMMAND_ID_PREFIX),
    "Reserved command ID prefix",
  ),
  instruction: z.string().trim().min(1),
}).strict();
const AnswerSchema = z.object({
  questionId: z.string().trim().min(1).max(200),
  answers: z.record(z.string().trim().min(1).max(500), z.string().trim().min(1).max(4000)),
}).strict();
const ModelSchema = z.object({
  role: z.string().trim().min(1).max(100),
  provider: z.string().trim().min(1).max(100),
  model: z.string().trim().min(1).max(200),
  credentialId: z.string().uuid().optional(),
  parameters: ParametersSchema.optional(),
}).strict();

export type RunRecord = RunRow;

export interface RunCommandRepository {
  enqueueRun(auth: RequestAuth, projectId: string, input: EnqueueRunInput): Promise<RunRecord | null>;
  command(auth: RequestAuth, projectId: string, runId: string, command: RunCommand, payload?: unknown): Promise<RunCommandResult>;
  validateModelSelection?(auth: RequestAuth, selection: z.infer<typeof ModelSchema>): Promise<boolean>;
  commandStatus?(auth: RequestAuth, projectId: string, runId: string, commandId: string): Promise<{ commandId: string; status: string; retryable: boolean; failureCategory: string | null; errorMessage: string | null } | null>;
  durableCommitActive?(runId: string, marker: unknown): Promise<boolean>;
}

interface RunRoutesOptions {
  repository: RunCommandRepository;
}

const notFoundBody = { error: "Run not found" } as const;
const invalidBody = { error: "Invalid request" } as const;
const conflictBody = { error: "Invalid run state" } as const;

export const runRoutes: FastifyPluginAsync<RunRoutesOptions> = async (app, options) => {
  app.addHook("preHandler", app.authenticateRequest);

  app.post("/", async (request, reply) => {
    const params = ParamsSchema.safeParse(request.params);
    const input = StartSchema.safeParse(request.body ?? {});
    if (!params.success || !input.success) return reply.code(400).send(invalidBody);
    const run = await options.repository.enqueueRun(request.auth, params.data.projectId, input.data);
    return run ? reply.code(201).send({ run }) : reply.code(404).send(notFoundBody);
  });
  app.get("/:runId/commands/:commandId", async (request, reply) => {
    const params = CommandParamsSchema.safeParse(request.params);
    if (!params.success || !options.repository.commandStatus) return reply.code(404).send(notFoundBody);
    const command = await options.repository.commandStatus(request.auth, params.data.projectId, params.data.runId, params.data.commandId);
    return command ? { command } : reply.code(404).send(notFoundBody);
  });

  for (const command of ["pause", "resume", "abort", "steer"] as const) {
    app.post(`/:runId/${command}`, async (request, reply) => {
      const params = ParamsSchema.safeParse(request.params);
      const input = command === "steer" ? SteerSchema.safeParse(request.body) : { success: true as const, data: undefined };
      if (!params.success || !params.data.runId || !input.success) return reply.code(400).send(invalidBody);
      const steer = command === "steer" && input.data ? input.data : undefined;
      const result = await options.repository.command(
        request.auth,
        params.data.projectId,
        params.data.runId,
        command,
        steer,
      );
      if (result === "missing") return reply.code(404).send(notFoundBody);
      if (result === "conflict") return reply.code(409).send(conflictBody);
      const resumeData = result.resumeData && typeof result.resumeData === "object" ? result.resumeData as Record<string, unknown> : {};
      const marker = resumeData.durableCommit;
      const waiting = command === "abort" && options.repository.durableCommitActive ? await options.repository.durableCommitActive(result.id, marker) : false;
      return reply.code(200).send({ run: result, waiting_for_durable_commit: waiting });
    });
  }

  app.post("/:runId/answer", async (request, reply) => {
    const params = ParamsSchema.safeParse(request.params);
    const input = AnswerSchema.safeParse(request.body);
    if (!params.success || !params.data.runId || !input.success) return reply.code(400).send(invalidBody);
    const instruction = `[AskUser] ${JSON.stringify(input.data)}`;
    const result = await options.repository.command(request.auth, params.data.projectId, params.data.runId, "steer", { commandId: `answer:${input.data.questionId}`, instruction });
    if (result === "missing") return reply.code(404).send(notFoundBody);
    if (result === "conflict") return reply.code(409).send(conflictBody);
    return reply.code(200).send({ run: result });
  });

  app.post("/:runId/model", async (request, reply) => {
    const params = ParamsSchema.safeParse(request.params);
    const input = ModelSchema.safeParse(request.body);
    if (!params.success || !params.data.runId || !input.success) return reply.code(400).send(invalidBody);
    if (options.repository.validateModelSelection && !await options.repository.validateModelSelection(request.auth, input.data)) return reply.code(400).send({ error: "Invalid model selection" });
    const instruction = `[ModelSwitch] ${JSON.stringify(input.data)}`;
    const commandId = `model:${request.id}`;
    const result = await options.repository.command(request.auth, params.data.projectId, params.data.runId, "steer", { commandId, instruction });
    if (result === "missing") return reply.code(404).send(notFoundBody);
    if (result === "conflict") return reply.code(409).send(conflictBody);
    return reply.code(200).send({ run: result, command: { commandId, status: "queued", appliesAfter: "agent_boundary" } });
  });
};
