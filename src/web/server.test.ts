import { describe, expect, it } from "vitest";
import { WebConfigSchema } from "./config.js";
import { buildWebServer } from "./server.js";

describe("buildWebServer", () => {
  it("serves the health endpoint", async () => {
    const app = await buildWebServer({ databaseUrl: "postgres://test:test@localhost/test" });
    const response = await app.inject({ method: "GET", url: "/api/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
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
});
