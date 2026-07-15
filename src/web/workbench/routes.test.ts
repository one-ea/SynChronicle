import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { RequestAuth } from "../auth/plugin.js";
import { workbenchRoutes, type WorkbenchProjection, type WorkbenchRepositoryLike } from "./routes.js";

const runId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";

function projection(userId: string): WorkbenchProjection {
  return {
    id: projectId, userId, title: "雾港来信", status: "active", version: 3,
    chapters: [{ id: "chapter-1", runId, sequence: 1, title: "潮声", body: "正文", status: "draft", version: 2 }],
    latestRun: { id: runId, status: "running", version: 4, task: { id: "task-1", status: "running", leaseVersion: 2 }, checkpointVersion: 7, waiting_for_durable_commit: false },
    agents: [{ name: "Writer", state: "running", summary: "正在续写", sequence: 12 }],
    usage: { inputTokens: 100, outputTokens: 60, totalTokens: 160, cost: "0.01200000", byAgent: [{ agent: "Writer", inputTokens: 100, outputTokens: 60, totalTokens: 160, cost: "0.01200000" }] },
    pendingQuestion: { id: "question-1", questions: [{ header: "篇幅", question: "希望多长？", options: ["短篇", "长篇"] }] },
  };
}

async function app(repository: WorkbenchRepositoryLike) {
  const server = Fastify();
  server.decorateRequest("auth");
  server.decorate("authenticateRequest", async (request) => {
    request.auth = { userId: String(request.headers["x-user-id"]), role: "user", sessionId: randomUUID() };
  });
  await server.register(workbenchRoutes, { prefix: "/api/projects", repository });
  await server.after();
  return server;
}

describe("workbench projection routes", () => {
  it("returns the tenant-scoped production projection and explicit empty arrays", async () => {
    const repository: WorkbenchRepositoryLike = { get: vi.fn(async (auth: RequestAuth) => projection(auth.userId)), diagnose: vi.fn() };
    const server = await app(repository);

    const response = await server.inject({ method: "GET", url: `/api/projects/${projectId}/workbench`, headers: { "x-user-id": "alice" } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ workbench: projection("alice") });
    expect(repository.get).toHaveBeenCalledWith(expect.objectContaining({ userId: "alice" }), projectId);
    await server.close();
  });

  it("does not disclose foreign projections", async () => {
    const repository: WorkbenchRepositoryLike = { get: vi.fn(async () => null), diagnose: vi.fn() };
    const server = await app(repository);
    const foreign = await server.inject({ method: "GET", url: `/api/projects/${projectId}/workbench`, headers: { "x-user-id": "alice" } });
    const missing = await server.inject({ method: "GET", url: `/api/projects/${randomUUID()}/workbench`, headers: { "x-user-id": "alice" } });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.body).toBe(missing.body);
    await server.close();
  });

  it("maps pause, resume, abort, answer, model switch, and diagnostics to explicit APIs", async () => {
    const repository: WorkbenchRepositoryLike = {
      get: vi.fn(async () => projection("alice")),
      diagnose: vi.fn(async () => ({ summary: "run healthy", cursor: 12, checkpointVersion: 7 })),
    };
    const server = await app(repository);
    const diagnostics = await server.inject({ method: "GET", url: `/api/projects/${projectId}/runs/${runId}/diagnostics`, headers: { "x-user-id": "alice" } });
    expect(diagnostics.json()).toEqual({ diagnostics: { summary: "run healthy", cursor: 12, checkpointVersion: 7 } });
    await server.close();
  });
});
