import { describe, expect, it, vi } from "vitest";
import type { Database } from "../../db/client.js";
import { buildWebServer } from "../server.js";

function testDatabase(): Database {
  return { $client: { end: vi.fn(async () => undefined) } } as unknown as Database;
}

describe("health routes", () => {
  it("reports liveness without consulting dependencies", async () => {
    const checkReadiness = vi.fn(async () => {
      throw new Error("database unavailable");
    });
    const app = await buildWebServer({
      database: testDatabase(),
      databaseOwnership: "borrowed",
      staticRoot: null,
      checkReadiness,
    } as Parameters<typeof buildWebServer>[0]);

    const response = await app.inject({ method: "GET", url: "/api/health/live" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    expect(checkReadiness).not.toHaveBeenCalled();
    await app.close();
  });

  it("reports readiness only after database access and migrations succeed", async () => {
    let available = true;
    const app = await buildWebServer({
      database: testDatabase(),
      databaseOwnership: "borrowed",
      staticRoot: null,
      checkReadiness: async () => {
        if (!available) throw new Error("database unavailable");
      },
    } as Parameters<typeof buildWebServer>[0]);

    const ready = await app.inject({ method: "GET", url: "/api/health/ready" });
    available = false;
    const unavailable = await app.inject({ method: "GET", url: "/api/health/ready" });

    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({ status: "ready" });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json()).toEqual({ status: "unavailable" });
    await app.close();
  });

  it("rejects new application requests after drain begins while keeping liveness observable", async () => {
    const app = await buildWebServer({
      database: testDatabase(),
      databaseOwnership: "borrowed",
      staticRoot: null,
      checkReadiness: async () => undefined,
    } as Parameters<typeof buildWebServer>[0]);
    app.readinessGate.beginDrain();

    const application = await app.inject({ method: "GET", url: "/api/projects" });
    const live = await app.inject({ method: "GET", url: "/api/health/live" });
    const ready = await app.inject({ method: "GET", url: "/api/health/ready" });

    expect(application.statusCode).toBe(503);
    expect(live.statusCode).toBe(200);
    expect(ready.statusCode).toBe(503);
    await app.close();
  });
});
