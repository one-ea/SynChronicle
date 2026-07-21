import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { adminRoutes } from "./routes.js";
import { platformCredentialSource, platformCredentialModel, resolvePlatformCredential } from "../../quota/platformCredential.js";
import { productionSecurityPlugin } from "../security/plugin.js";

async function server(role: "user" | "admin") {
  const app = Fastify();
  app.decorateRequest("auth");
  app.decorate("authenticateRequest", async (request) => { request.auth = { userId: "11111111-1111-4111-8111-111111111111", role, sessionId: "s" }; });
  await app.register(productionSecurityPlugin, { publicUrl: "https://app.example.test" });
  const repository = { listModels: vi.fn(async () => []), createModel: vi.fn(async () => ({ id: "m" })), updateModel: vi.fn(async () => ({ id: "m" })), deleteModel: vi.fn(async () => "deleted" as const), setBalance: vi.fn(async () => ({ balanceUsd: 10 })), setPlatformConcurrency: vi.fn(async () => ({ platformConcurrency: 4 })) };
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
    repository.listModels.mockResolvedValueOnce([{ id: "m", provider: "openai", model: "gpt", credentialReference: "env:SECRET_NAME" }] as never);
    const response = await app.inject({ method: "GET", url: "/api/admin/models" });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain("SECRET_NAME");
    expect(response.json()).toEqual({ models: [expect.objectContaining({ credentialSource: "environment" })] });
    await app.close();
  });

  it("reports the actual credential source without exposing its reference", () => {
    expect(platformCredentialSource("env:OPENAI_API_KEY")).toBe("environment");
    expect(platformCredentialSource("credential:22222222-2222-4222-8222-222222222222")).toBe("encrypted");
  });

  it("resolves environment and encrypted platform credentials for execution", async () => {
    const service = { resolve: vi.fn(async () => ({ provider: "openai", apiKey: "encrypted-secret", baseUrl: "https://api.openai.com" })) };
    await expect(resolvePlatformCredential({ reference: "env:PLATFORM_OPENAI_KEY", provider: "openai", environment: { PLATFORM_OPENAI_KEY: "env-secret" }, credentialOwnerId: "admin", credentials: service as never, runId: "run" })).resolves.toMatchObject({ apiKey: "env-secret", source: "environment" });
    await expect(resolvePlatformCredential({ reference: "credential:22222222-2222-4222-8222-222222222222", provider: "openai", environment: {}, credentialOwnerId: "admin", credentials: service as never, runId: "run" })).resolves.toMatchObject({ apiKey: "encrypted-secret", source: "encrypted" });
    expect(service.resolve).toHaveBeenCalledWith("admin", "22222222-2222-4222-8222-222222222222", expect.any(Object));
  });

  it("injects the resolved platform credential into the provider execution", async () => {
    const factory = vi.fn((_provider, config) => ({ doGenerate: async () => ({ keySeen: config.api_key }) }));
    const model = platformCredentialModel({ provider: "openai", model: "gpt", runId: "run", base: {}, load: async () => ({ credentialReference: "env:PLATFORM_KEY", metadata: {} }), environment: { PLATFORM_KEY: "runtime-secret" }, credentials: { resolve: vi.fn() } as never, factory: factory as never });
    await expect((model as never as { doGenerate(input: unknown): Promise<unknown> }).doGenerate({})).resolves.toEqual({ keySeen: "runtime-secret" });
    expect(factory).toHaveBeenCalledWith("openai", expect.objectContaining({ api_key: "runtime-secret" }), "gpt");
  });

  it("releases an encrypted credential when provider factory creation fails", async () => {
    const secret = { provider: "openai", apiKey: "encrypted-secret", baseUrl: "https://api.openai.com" };
    const model = platformCredentialModel({ provider: "openai", model: "gpt", runId: "run", base: {}, load: async () => ({ credentialReference: "credential:22222222-2222-4222-8222-222222222222", metadata: { credentialOwnerId: "admin" } }), environment: {}, credentials: { resolve: vi.fn(async () => secret) } as never, factory: () => { throw new Error("factory failed"); } });

    await expect((model as never as { doGenerate(input: unknown): Promise<unknown> }).doGenerate({})).rejects.toThrow("factory failed");

    expect(secret).toEqual({ provider: "openai", apiKey: "", baseUrl: undefined });
  });

  it("persists and returns normalized model capabilities", async () => {
    const { app, repository } = await server("admin");
    const created = { id: "m", provider: "openai", model: "gpt", status: "active", capabilities: { contextWindow: 128000, maxOutputTokens: 16384, pricing: { inputPer1M: 1, outputPer1M: 2 }, modalities: { text: true, vision: true, audio: false }, tools: { toolCalling: true, structuredOutput: false, jsonMode: false }, generation: { streaming: true, temperature: { min: 0, max: 2 }, reasoningEffort: ["low", "medium"], systemPrompt: true }, policy: { allowPlatformCredential: true, allowUserCredential: true, tags: [] } }, inputPrice: "1", outputPrice: "2", credentialReference: "env:OPENAI_API_KEY", metadata: {} };
    repository.createModel.mockResolvedValueOnce(created as never);
    repository.listModels.mockResolvedValueOnce([created] as never);

    const headers = { origin: "https://app.example.test" };
    const createResponse = await app.inject({
      method: "POST", url: "/api/admin/models",
      headers,
      payload: { provider: "openai", model: "gpt", status: "active", inputPrice: 1, outputPrice: 2, credentialReference: "env:OPENAI_API_KEY", capabilities: { contextWindow: 128000, maxOutputTokens: 16384, generation: { reasoningEffort: ["low", "medium"] } } },
    });
    expect(createResponse.statusCode).toBe(201);
    expect(createResponse.json().model).toHaveProperty("capabilities");

    const listResponse = await app.inject({ method: "GET", url: "/api/admin/models" });
    expect(listResponse.json().models[0]).toHaveProperty("capabilities");
    expect(listResponse.json().models[0]).not.toHaveProperty("credentialReference");
    await app.close();
  });

  it("rejects capabilities with negative context window", async () => {
    const { app } = await server("admin");
    const response = await app.inject({
      method: "POST", url: "/api/admin/models",
      headers: { origin: "https://app.example.test" },
      payload: { provider: "openai", model: "gpt", status: "active", inputPrice: 1, outputPrice: 2, credentialReference: "env:OPENAI_API_KEY", capabilities: { contextWindow: -1, maxOutputTokens: 100 } },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });
});
