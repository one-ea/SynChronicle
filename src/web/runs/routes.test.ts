import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { RequestAuth } from "../auth/plugin.js";
import { runRoutes, type RunCommandRepository, type RunRecord } from "./routes.js";

class MemoryRuns implements RunCommandRepository {
  readonly runs = new Map<string, RunRecord>();
  readonly starts = new Map<string, string>();

  async enqueueRun(auth: RequestAuth, projectId: string, input: { idempotencyKey: string }): Promise<RunRecord | null> {
    if (projectId === "missing") return null;
    const existingId = this.starts.get(`${auth.userId}:${projectId}:${input.idempotencyKey}`);
    if (existingId) return this.runs.get(existingId)!;
    const now = new Date();
    const run: RunRecord = {
      id: randomUUID(), userId: auth.userId, projectId, status: "queued", latestCheckpointId: null,
      idempotencyKey: input.idempotencyKey,
      budgetSnapshot: {}, resumeData: { desiredState: "running" }, startedAt: null, completedAt: null,
      createdAt: now, updatedAt: now,
    };
    this.runs.set(run.id, run);
    this.starts.set(`${auth.userId}:${projectId}:${input.idempotencyKey}`, run.id);
    return run;
  }

  async command(auth: RequestAuth, projectId: string, runId: string, command: "pause" | "resume" | "abort" | "steer", payload?: unknown) {
    const run = this.runs.get(runId);
    if (!run || run.userId !== auth.userId || run.projectId !== projectId) return "missing" as const;
    const desiredState = (run.resumeData as { desiredState: string }).desiredState;
    if (run.status === "cancelled" && command === "abort") return run;
    if (["completed", "failed", "cancelled"].includes(run.status)) return "conflict" as const;
    if (desiredState === "cancelled" && command !== "abort") return "conflict" as const;
    if (command === "pause" && desiredState === "paused") return run;
    if (command === "resume" && desiredState === "running") return run;
    if (command === "abort" && desiredState === "cancelled") return run;
    if (command === "steer" && (!payload || typeof payload !== "object")) return "conflict" as const;
    const steer = payload as { commandId: string; instruction: string };
    const existingCommands = ((run.resumeData as { steerCommands?: Array<{ id: string; instruction: string }> }).steerCommands ?? []);
    const next = {
      ...run,
      resumeData: command === "steer"
        ? { ...(run.resumeData as object), steerCommands: existingCommands.some(({ id }) => id === steer.commandId) ? existingCommands : [...existingCommands, { id: steer.commandId, instruction: steer.instruction }] }
        : { ...(run.resumeData as object), desiredState: command === "pause" ? "paused" : command === "abort" ? "cancelled" : "running" },
    };
    this.runs.set(run.id, next);
    return next;
  }
}

async function testApp() {
  const repository = new MemoryRuns();
  const app = Fastify();
  app.decorateRequest("auth");
  app.decorate("authenticateRequest", async (request) => {
    request.auth = { userId: String(request.headers["x-user-id"]), role: "user", sessionId: "test" };
  });
  await app.register(runRoutes, { prefix: "/api/projects/:projectId/runs", repository });
  await app.after();
  return { app, repository };
}

describe("run command routes", () => {
  it("starts a run and persists idempotent desired-state commands", async () => {
    const { app } = await testApp();
    const headers = { "x-user-id": "alice" };
    const start = await app.inject({ method: "POST", url: "/api/projects/project-a/runs", headers, payload: { idempotencyKey: "start-1" } });
    const run = start.json().run as RunRecord;

    const pause = await app.inject({ method: "POST", url: `/api/projects/project-a/runs/${run.id}/pause`, headers });
    const repeated = await app.inject({ method: "POST", url: `/api/projects/project-a/runs/${run.id}/pause`, headers });
    const resume = await app.inject({ method: "POST", url: `/api/projects/project-a/runs/${run.id}/resume`, headers });
    const steer = await app.inject({ method: "POST", url: `/api/projects/project-a/runs/${run.id}/steer`, headers, payload: { commandId: "steer-1", instruction: "Focus on pacing" } });

    expect(start.statusCode).toBe(201);
    expect(pause.json().run.resumeData.desiredState).toBe("paused");
    expect(repeated.json()).toEqual(pause.json());
    expect(resume.json().run.resumeData.desiredState).toBe("running");
    expect(steer.json().run.resumeData.steerCommands).toEqual([{ id: "steer-1", instruction: "Focus on pacing" }]);
    await app.close();
  });

  it("isolates tenants and returns 409 for commands on terminal runs", async () => {
    const { app, repository } = await testApp();
    const start = await app.inject({ method: "POST", url: "/api/projects/project-a/runs", headers: { "x-user-id": "alice" }, payload: { idempotencyKey: "start-2" } });
    const run = start.json().run as RunRecord;
    repository.runs.set(run.id, { ...run, status: "completed" });

    const foreign = await app.inject({ method: "POST", url: `/api/projects/project-a/runs/${run.id}/pause`, headers: { "x-user-id": "bob" } });
    const conflict = await app.inject({ method: "POST", url: `/api/projects/project-a/runs/${run.id}/resume`, headers: { "x-user-id": "alice" } });

    expect(foreign.statusCode).toBe(404);
    expect(conflict.statusCode).toBe(409);
    await app.close();
  });

  it("makes abort idempotent and rejects later state changes", async () => {
    const { app, repository } = await testApp();
    const headers = { "x-user-id": "alice" };
    const start = await app.inject({ method: "POST", url: "/api/projects/project-a/runs", headers, payload: { idempotencyKey: "start-3" } });
    const run = start.json().run as RunRecord;

    const abort = await app.inject({ method: "POST", url: `/api/projects/project-a/runs/${run.id}/abort`, headers });
    const repeated = await app.inject({ method: "POST", url: `/api/projects/project-a/runs/${run.id}/abort`, headers });
    const resume = await app.inject({ method: "POST", url: `/api/projects/project-a/runs/${run.id}/resume`, headers });
    repository.runs.set(run.id, { ...repository.runs.get(run.id)!, status: "cancelled" });
    const appliedRepeat = await app.inject({ method: "POST", url: `/api/projects/project-a/runs/${run.id}/abort`, headers });

    expect(abort.json().run.resumeData.desiredState).toBe("cancelled");
    expect(repeated.json()).toEqual(abort.json());
    expect(resume.statusCode).toBe(409);
    expect(appliedRepeat.statusCode).toBe(200);
    await app.close();
  });

  it("requires a start idempotency key and returns the same run on retry", async () => {
    const { app } = await testApp();
    const headers = { "x-user-id": "alice" };
    const invalid = await app.inject({ method: "POST", url: "/api/projects/project-a/runs", headers, payload: {} });
    const first = await app.inject({ method: "POST", url: "/api/projects/project-a/runs", headers, payload: { idempotencyKey: "stable-start" } });
    const retry = await app.inject({ method: "POST", url: "/api/projects/project-a/runs", headers, payload: { idempotencyKey: "stable-start" } });
    const otherTenant = await app.inject({ method: "POST", url: "/api/projects/project-a/runs", headers: { "x-user-id": "bob" }, payload: { idempotencyKey: "stable-start" } });

    expect(invalid.statusCode).toBe(400);
    expect(retry.json().run.id).toBe(first.json().run.id);
    expect(otherTenant.json().run.id).not.toBe(first.json().run.id);
    await app.close();
  });

  it("deduplicates steer by command ID while preserving repeated text with a new ID", async () => {
    const { app } = await testApp();
    const headers = { "x-user-id": "alice" };
    const start = await app.inject({ method: "POST", url: "/api/projects/project-a/runs", headers, payload: { idempotencyKey: "steer-start" } });
    const run = start.json().run as RunRecord;
    const url = `/api/projects/project-a/runs/${run.id}/steer`;
    const first = await app.inject({ method: "POST", url, headers, payload: { commandId: "command-1", instruction: "Revise" } });
    const retry = await app.inject({ method: "POST", url, headers, payload: { commandId: "command-1", instruction: "Revise" } });
    const repeatedText = await app.inject({ method: "POST", url, headers, payload: { commandId: "command-2", instruction: "Revise" } });

    expect(retry.json()).toEqual(first.json());
    expect(repeatedText.json().run.resumeData.steerCommands).toEqual([
      { id: "command-1", instruction: "Revise" },
      { id: "command-2", instruction: "Revise" },
    ]);
    await app.close();
  });

  it("rejects client command IDs in the reserved legacy namespace", async () => {
    const { app } = await testApp();
    const headers = { "x-user-id": "alice" };
    const start = await app.inject({ method: "POST", url: "/api/projects/project-a/runs", headers, payload: { idempotencyKey: "reserved-start" } });
    const run = start.json().run as RunRecord;

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/project-a/runs/${run.id}/steer`,
      headers,
      payload: { commandId: "legacy:client-value", instruction: "Collision" },
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("maps AskUser answers and model switches onto durable run commands", async () => {
    const { app } = await testApp();
    const headers = { "x-user-id": "alice" };
    const start = await app.inject({ method: "POST", url: "/api/projects/project-a/runs", headers, payload: { idempotencyKey: "interactive-start" } });
    const run = start.json().run as RunRecord;
    const answer = await app.inject({ method: "POST", url: `/api/projects/project-a/runs/${run.id}/answer`, headers, payload: { questionId: "event-8", answers: { "希望多长？": "长篇" } } });
    const model = await app.inject({ method: "POST", url: `/api/projects/project-a/runs/${run.id}/model`, headers, payload: { role: "writer", provider: "openai", model: "gpt-5" } });

    expect(answer.statusCode).toBe(200);
    expect(model.statusCode).toBe(200);
    expect(model.json().run.resumeData.steerCommands).toEqual(expect.arrayContaining([
      expect.objectContaining({ instruction: "[AskUser] {\"questionId\":\"event-8\",\"answers\":{\"希望多长？\":\"长篇\"}}" }),
      expect.objectContaining({ instruction: "[ModelSwitch] {\"role\":\"writer\",\"provider\":\"openai\",\"model\":\"gpt-5\"}" }),
    ]));
    await app.close();
  });
});
