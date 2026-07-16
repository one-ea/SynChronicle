import Fastify from "fastify";
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { productionSecurityPlugin } from "./plugin.js";

async function securityServer(role: "user" | "admin" = "user") {
  const app = Fastify({ bodyLimit: 1024 });
  app.decorateRequest("auth");
  app.decorate("authenticateRequest", async (request) => {
    request.auth = { userId: "user-1", role, sessionId: "session-1" };
  });
  await app.register(productionSecurityPlugin, {
    publicUrl: "https://app.example.test",
    maxBodyBytes: 32,
    rateLimits: { default: { max: 2, windowMs: 60_000 } },
  });
  app.get("/api/read", async () => ({ ok: true }));
  app.post("/api/write", async () => ({ ok: true }));
  app.get("/api/admin/check", async () => ({ ok: true }));
  app.get("/api/error", async () => { throw Object.assign(new Error("token=top-secret"), { statusCode: 500 }); });
  return app;
}

describe("production security plugin", () => {
  it("sets nonce-based production headers without unsafe-eval", async () => {
    const app = await securityServer();
    const response = await app.inject({ method: "GET", url: "/api/read" });

    expect(response.headers["content-security-policy"]).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9_-]+'/);
    expect(response.headers["content-security-policy"]).not.toContain("unsafe-eval");
    expect(response.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(response.headers["strict-transport-security"]).toContain("max-age=31536000");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["permissions-policy"]).toContain("camera=()");
    await app.close();
  });

  it("omits HSTS for plain HTTP deployments", async () => {
    const app = Fastify();
    app.decorateRequest("auth");
    app.decorate("authenticateRequest", async (request) => { request.auth = { userId: "user-1", role: "user", sessionId: "session-1" }; });
    await app.register(productionSecurityPlugin, { publicUrl: "http://app.example.test" });
    app.get("/api/read", async () => ({ ok: true }));

    const response = await app.inject({ method: "GET", url: "/api/read" });
    expect(response.headers["strict-transport-security"]).toBeUndefined();
    await app.close();
  });

  it("allows the 50 MiB import route and rejects declared or chunked overflow", async () => {
    const app = Fastify({ bodyLimit: 51 * 1024 * 1024 });
    app.decorateRequest("auth");
    app.decorate("authenticateRequest", async (request) => { request.auth = { userId: "user-1", role: "user", sessionId: "session-1" }; });
    await app.register(productionSecurityPlugin, { publicUrl: "https://app.example.test", bodyLimits: { default: 32, routes: { "POST:/api/projects/import": 50 * 1024 * 1024 } } });
    app.addContentTypeParser("application/octet-stream", { parseAs: "buffer" }, (_request, body, done) => done(null, body));
    app.post("/api/projects/import", async () => ({ ok: true }));
    app.post("/api/write", async () => ({ ok: true }));

    const accepted = await app.inject({ method: "POST", url: "/api/projects/import", headers: { origin: "https://app.example.test", "content-type": "application/octet-stream" }, payload: Buffer.alloc(50 * 1024 * 1024) });
    const declaredOverflow = await app.inject({ method: "POST", url: "/api/projects/import", headers: { origin: "https://app.example.test", "content-length": String(50 * 1024 * 1024 + 1) } });
    const chunkedOverflow = await app.inject({ method: "POST", url: "/api/write", headers: { origin: "https://app.example.test", "content-type": "text/plain", "transfer-encoding": "chunked" }, payload: "x".repeat(33) });

    expect(accepted.statusCode).toBe(200);
    expect(declaredOverflow.statusCode).toBe(413);
    expect(chunkedOverflow.statusCode).toBe(413);
    await app.close();
  });

  it("honors only requests arriving through the trusted proxy allowlist", async () => {
    const app = Fastify({ trustProxy: ["127.0.0.1"] });
    app.decorateRequest("auth");
    app.decorate("authenticateRequest", async (request) => { request.auth = { userId: "user-1", role: "user", sessionId: "session-1" }; });
    await app.register(productionSecurityPlugin, { publicUrl: "https://app.example.test" });
    app.get("/api/ip", async (request) => ({ ip: request.ip }));

    const trusted = await app.inject({ method: "GET", url: "/api/ip", headers: { "x-forwarded-for": "203.0.113.10" }, remoteAddress: "127.0.0.1" });
    const untrusted = await app.inject({ method: "GET", url: "/api/ip", headers: { "x-forwarded-for": "203.0.113.10" }, remoteAddress: "192.0.2.20" });
    expect(trusted.json()).toEqual({ ip: "203.0.113.10" });
    expect(untrusted.json()).toEqual({ ip: "192.0.2.20" });
    await app.close();
  });

  it("rejects missing or cross-origin mutations and oversized bodies", async () => {
    const app = await securityServer();
    const missing = await app.inject({ method: "POST", url: "/api/write", payload: { value: "ok" } });
    const foreign = await app.inject({ method: "POST", url: "/api/write", headers: { origin: "https://attacker.example" }, payload: { value: "ok" } });
    const oversized = await app.inject({ method: "POST", url: "/api/write", headers: { origin: "https://app.example.test", "content-type": "text/plain" }, payload: "x".repeat(33) });

    expect(missing.statusCode).toBe(403);
    expect(foreign.statusCode).toBe(403);
    expect(oversized.statusCode).toBe(413);
    await app.close();
  });

  it("rate limits by route and client identity", async () => {
    const app = await securityServer();
    const request = () => app.inject({ method: "GET", url: "/api/read", headers: { cookie: "synchronicle_session=stable-session" } });

    expect((await request()).statusCode).toBe(200);
    expect((await request()).statusCode).toBe(200);
    const limited = await request();
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBeDefined();
    await app.close();
  });

  it("enforces admin RBAC for every route under the admin prefix", async () => {
    const userApp = await securityServer("user");
    expect((await userApp.inject({ method: "GET", url: "/api/admin/check" })).statusCode).toBe(403);
    await userApp.close();

    const adminApp = await securityServer("admin");
    expect((await adminApp.inject({ method: "GET", url: "/api/admin/check" })).statusCode).toBe(200);
    await adminApp.close();
  });

  it("returns a generic request-correlated error response", async () => {
    const app = await securityServer();
    const response = await app.inject({ method: "GET", url: "/api/error", headers: { "x-request-id": "11111111-1111-4111-8111-111111111111" } });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "Internal Server Error", requestId: expect.any(String) });
    expect(response.body).not.toContain("top-secret");
    await app.close();
  });

  it("recursively redacts nested secrets from request error logs", async () => {
    let logs = "";
    const stream = new Writable({ write(chunk, _encoding, callback) { logs += chunk.toString(); callback(); } });
    const app = Fastify({ logger: { level: "error", stream } });
    app.decorateRequest("auth");
    app.decorate("authenticateRequest", async (request) => { request.auth = { userId: "user-1", role: "user", sessionId: "session-1" }; });
    await app.register(productionSecurityPlugin, { publicUrl: "https://app.example.test" });
    app.get("/api/error", async () => { throw new Error("failed", { cause: { nested: [{ password: "secret-password", authorization: "Bearer secret-token" }] } }); });

    await app.inject({ method: "GET", url: "/api/error" });
    expect(logs).toContain("[REDACTED]");
    expect(logs).not.toContain("secret-password");
    expect(logs).not.toContain("secret-token");
    await app.close();
  });
});
