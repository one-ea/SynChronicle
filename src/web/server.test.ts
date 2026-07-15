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
