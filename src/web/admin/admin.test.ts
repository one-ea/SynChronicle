import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { adminRoutes } from "./routes.js";

async function server(role: "user" | "admin") {
  const app = Fastify();
  app.decorateRequest("auth");
  app.decorate("authenticateRequest", async (request) => { request.auth = { userId: "11111111-1111-4111-8111-111111111111", role, sessionId: "s" }; });
  const repository = { listModels: vi.fn(async () => []), createModel: vi.fn(async () => ({ id: "m" })), updateModel: vi.fn(async () => ({ id: "m" })), setBalance: vi.fn(async () => ({ balanceUsd: 10 })), setPlatformConcurrency: vi.fn(async () => ({ platformConcurrency: 4 })) };
  await app.register(adminRoutes, { prefix: "/api/admin", repository });
  return { app, repository };
}

describe("admin routes", () => {
  it("rejects non-admin model management", async () => {
    const { app, repository } = await server("user");
    expect((await app.inject({ method: "GET", url: "/api/admin/models" })).statusCode).toBe(403);
    expect(repository.listModels).not.toHaveBeenCalled();
    await app.close();
  });

  it("never returns the platform credential reference", async () => {
    const { app, repository } = await server("admin");
    repository.listModels.mockResolvedValueOnce([{ id: "m", provider: "openai", model: "gpt", credentialSource: "environment", credentialReference: "SECRET_NAME" }] as never);
    const response = await app.inject({ method: "GET", url: "/api/admin/models" });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain("SECRET_NAME");
    expect(response.json()).toEqual({ models: [expect.objectContaining({ credentialSource: "environment" })] });
    await app.close();
  });
});
