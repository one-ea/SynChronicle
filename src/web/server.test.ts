import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "../db/client.js";
import { WebConfigSchema } from "./config.js";
import { buildWebServer, type WebServerInstance, type WebServerOptions } from "./server.js";

async function withServer(options: WebServerOptions, test: (app: WebServerInstance) => Promise<void>) {
  const app = await buildWebServer(options);
  try {
    await test(app);
  } finally {
    await app.close();
  }
}

describe("buildWebServer", () => {
  it("serves the health endpoint", async () => {
    await withServer({ databaseUrl: "postgres://test:test@localhost/test" }, async (app) => {
      const response = await app.inject({ method: "GET", url: "/api/health" });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: "ok" });
      expect(response.headers["x-request-id"]).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });
  }, 30_000);

  it("serves an injected static application without relying on build artifacts", async () => {
    const staticRoot = await mkdtemp(join(tmpdir(), "synchronicle-web-"));
    await writeFile(join(staticRoot, "index.html"), "<div id=\"root\">isolated fixture</div>");
    await withServer({ databaseUrl: "postgres://test:test@localhost/test", staticRoot }, async (app) => {
      const response = await app.inject({ method: "GET", url: "/login" });

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("text/html");
      expect(response.body).toContain("isolated fixture");
    });
  }, 30_000);

  it("accepts a valid client request ID and replaces an invalid value", async () => {
    const requestId = "d12f18f0-6a82-4c2a-a9be-c2ea8846262c";
    await withServer({ databaseUrl: "postgres://test:test@localhost/test", staticRoot: null }, async (app) => {

      const accepted = await app.inject({ method: "GET", url: "/api/health", headers: { "x-request-id": requestId } });
      const replaced = await app.inject({ method: "GET", url: "/api/health", headers: { "x-request-id": "../../invalid request id" } });

      expect(accepted.headers["x-request-id"]).toBe(requestId);
      expect(replaced.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
      expect(replaced.headers["x-request-id"]).not.toBe("../../invalid request id");
    });
  });

  it("requires an explicit trusted proxy allowlist", async () => {
    const config = WebConfigSchema.parse({
      databaseUrl: "postgres://test:test@localhost/test",
      publicUrl: "https://app.example.test",
      sessionSecret: "s".repeat(32),
      credentialMasterKeys: `v1:${Buffer.alloc(32, "k").toString("base64")}`,
      credentialMasterKeyVersion: "v1",
    });
    expect(config.trustProxy).toBe(false);
    expect(WebConfigSchema.parse({ ...config, trustProxy: "127.0.0.1,10.0.0.0/8" }).trustProxy).toEqual(["127.0.0.1", "10.0.0.0/8"]);
    expect(() => WebConfigSchema.parse({ ...config, trustProxy: "true" })).toThrow("TRUST_PROXY");
  });

  it("strictly parses project provider host policy configuration", () => {
    const base = {
      databaseUrl: "postgres://test:test@localhost/test",
      publicUrl: "https://app.example.test",
      sessionSecret: "s".repeat(32),
      credentialMasterKeys: `v1:${Buffer.alloc(32, "k").toString("base64")}`,
      credentialMasterKeyVersion: "v1",
    };
    expect(WebConfigSchema.parse({ ...base, providerAllowedHosts: JSON.stringify({ openai: ["gateway.example.com"] }) }).providerAllowedHosts).toEqual(new Map([["openai", ["gateway.example.com"]]]));
    expect(() => WebConfigSchema.parse({ ...base, providerAllowedHosts: JSON.stringify({ openai: ["*"] }) })).toThrow("PROJECT_PROVIDER_ALLOWED_HOSTS");
  });

  it("awaits closing an owned injected database client", async () => {
    let release!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const end = vi.fn(() => new Promise<void>((resolve) => {
      release = resolve;
      markStarted();
    }));
    const database = { $client: { end } } as unknown as Database;
    const app = await buildWebServer({
      database,
      databaseOwnership: "owned",
      publicUrl: "https://app.example.test",
    });

    let closed = false;
    const closing = app.close().then(() => {
      closed = true;
    });
    await started;
    expect(end).toHaveBeenCalledOnce();
    expect(closed).toBe(false);
    release();
    await closing;
    expect(closed).toBe(true);
  });

  it("leaves a borrowed injected database client open", async () => {
    const end = vi.fn(async () => undefined);
    const database = { $client: { end } } as unknown as Database;
    const app = await buildWebServer({
      database,
      databaseOwnership: "borrowed",
      publicUrl: "https://app.example.test",
    });

    await app.close();
    expect(end).not.toHaveBeenCalled();
  });
});
