import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "../db/client.js";
import { WebConfigSchema } from "./config.js";
import { buildWebServer } from "./server.js";

describe("buildWebServer", () => {
  it("serves the health endpoint", async () => {
    const app = await buildWebServer({ databaseUrl: "postgres://test:test@localhost/test" });
    const response = await app.inject({ method: "GET", url: "/api/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    expect(response.headers["x-request-id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    await app.close();
  });

  it("serves an injected static application without relying on build artifacts", async () => {
    const staticRoot = await mkdtemp(join(tmpdir(), "synchronicle-web-"));
    await writeFile(join(staticRoot, "index.html"), "<div id=\"root\">isolated fixture</div>");
    const app = await buildWebServer({ databaseUrl: "postgres://test:test@localhost/test", staticRoot } as Parameters<typeof buildWebServer>[0]);
    const response = await app.inject({ method: "GET", url: "/login" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("isolated fixture");
    await app.close();
  });

  it("accepts a valid client request ID and replaces an invalid value", async () => {
    const requestId = "d12f18f0-6a82-4c2a-a9be-c2ea8846262c";
    const app = await buildWebServer({ databaseUrl: "postgres://test:test@localhost/test", staticRoot: null } as Parameters<typeof buildWebServer>[0]);

    const accepted = await app.inject({ method: "GET", url: "/api/health", headers: { "x-request-id": requestId } });
    const replaced = await app.inject({ method: "GET", url: "/api/health", headers: { "x-request-id": "../../invalid request id" } });

    expect(accepted.headers["x-request-id"]).toBe(requestId);
    expect(replaced.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(replaced.headers["x-request-id"]).not.toBe("../../invalid request id");
    await app.close();
  });

  it("disables trusted proxy handling by default", async () => {
    const config = WebConfigSchema.parse({
      databaseUrl: "postgres://test:test@localhost/test",
      publicUrl: "https://app.example.test",
      sessionSecret: "s".repeat(32),
      credentialMasterKey: "k".repeat(32),
    });
    expect(config.trustProxy).toBe(false);
    expect(WebConfigSchema.parse({ ...config, trustProxy: "true" }).trustProxy).toBe(true);
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
