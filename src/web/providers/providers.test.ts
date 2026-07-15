import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { modelConfigurationRoutes } from "./routes.js";

async function app() {
  const server = Fastify();
  server.decorateRequest("auth");
  server.decorate("authenticateRequest", async (request) => { request.auth = { userId: "11111111-1111-4111-8111-111111111111", role: "user", sessionId: "session" }; });
  const credentials = {
    create: vi.fn(async (_userId, input) => ({ id: "22222222-2222-4222-8222-222222222222", provider: input.provider, label: input.label, status: "active", keyVersion: "v1" })),
    list: vi.fn(async () => [{ id: "22222222-2222-4222-8222-222222222222", provider: "openai", label: "Primary", status: "active", keyVersion: "v1" }]),
    replace: vi.fn(async () => ({ id: "22222222-2222-4222-8222-222222222222", provider: "openai", label: "Primary", status: "active", keyVersion: "v1" })),
    disable: vi.fn(async () => ({ id: "22222222-2222-4222-8222-222222222222", status: "disabled" })),
    revoke: vi.fn(async () => ({ id: "22222222-2222-4222-8222-222222222222", status: "revoked" })),
  };
  const models = { list: vi.fn(async () => []), create: vi.fn(), revise: vi.fn(), activate: vi.fn() };
  await server.register(modelConfigurationRoutes, { prefix: "/api/providers", repository: models, credentials, consumeCredentialMutation: () => true });
  return { server, credentials };
}

describe("provider credential routes", () => {
  it("creates and lists metadata without serializing plaintext", async () => {
    const { server } = await app();
    const created = await server.inject({ method: "POST", url: "/api/providers/credentials", payload: { provider: "openai", label: "Primary", apiKey: "secret-value" } });
    const listed = await server.inject({ method: "GET", url: "/api/providers/credentials" });
    expect(created.statusCode).toBe(201);
    expect(JSON.stringify(created.json())).not.toContain("secret-value");
    expect(JSON.stringify(listed.json())).not.toContain("secret-value");
    await server.close();
  });

  it("rejects unknown fields and rate-limits credential mutations", async () => {
    const { server } = await app();
    const invalid = await server.inject({ method: "POST", url: "/api/providers/credentials", payload: { provider: "openai", apiKey: "secret", secret: "extra" } });
    expect(invalid.statusCode).toBe(400);
    await server.close();

    const limited = Fastify();
    limited.decorateRequest("auth");
    limited.decorate("authenticateRequest", async (request) => { request.auth = { userId: "u", role: "user", sessionId: "s" }; });
    await limited.register(modelConfigurationRoutes, { prefix: "/api/providers", repository: { list: async () => [], create: async () => ({}), revise: async () => null, activate: async () => false }, credentials: { create: async () => ({}), list: async () => [], replace: async () => null, disable: async () => null, revoke: async () => null }, consumeCredentialMutation: () => false });
    expect((await limited.inject({ method: "POST", url: "/api/providers/credentials", payload: { provider: "openai", apiKey: "secret" } })).statusCode).toBe(429);
    await limited.close();
  });
});
