import { describe, expect, it } from "vitest";
import { buildWebServer } from "./server.js";

describe("buildWebServer", () => {
  it("serves the health endpoint", async () => {
    const app = await buildWebServer({ databaseUrl: "postgres://test:test@localhost/test" });
    const response = await app.inject({ method: "GET", url: "/api/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    await app.close();
  });
});
