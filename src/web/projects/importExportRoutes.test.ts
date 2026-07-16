import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { importExportRoutes } from "./importExportRoutes.js";

async function appFor(userId = "alice") {
  const app = Fastify({ genReqId: () => randomUUID() });
  app.decorateRequest("auth");
  app.decorate("authenticateRequest", async (request) => { request.auth = { userId, role: "user", sessionId: "session" }; });
  const importer = vi.fn(async () => ({ project: { id: "new", title: "Imported" } }));
  const exporter = vi.fn(async (_userId: string, projectId: string) => projectId === "foreign" ? null : Buffer.from("PK archive"));
  await app.register(importExportRoutes, { prefix: "/api/projects", importer, exporter, maxArchiveBytes: 32 });
  await app.after();
  return { app, importer, exporter };
}

describe("project import and export routes", () => {
  it("validates upload extension, MIME and size before import", async () => {
    const { app, importer } = await appFor();
    const invalid = await app.inject({ method: "POST", url: "/api/projects/import?filename=project.txt", headers: { "content-type": "text/plain" }, payload: "bad" });
    const oversized = await app.inject({ method: "POST", url: "/api/projects/import?filename=project.sync.zip", headers: { "content-type": "application/zip" }, payload: Buffer.alloc(33) });
    expect(invalid.statusCode).toBe(415);
    expect(oversized.statusCode).toBe(413);
    expect(importer).not.toHaveBeenCalled();
    await app.close();
  });

  it("imports for the authenticated tenant and returns progress-complete metadata", async () => {
    const { app, importer } = await appFor();
    const response = await app.inject({ method: "POST", url: "/api/projects/import?filename=project.sync.zip", headers: { "content-type": "application/zip" }, payload: Buffer.from("PK") });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ project: { id: "new" }, progress: 100 });
    expect(importer).toHaveBeenCalledWith("alice", expect.anything(), expect.any(String));
    await app.close();
  });

  it("streams a tenant-scoped download with a safe disposition", async () => {
    const { app, exporter } = await appFor();
    const response = await app.inject({ method: "GET", url: "/api/projects/project/export" });
    const foreign = await app.inject({ method: "GET", url: "/api/projects/foreign/export" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/zip");
    expect(response.headers["content-disposition"]).toMatch(/^attachment; filename="project-[a-zA-Z0-9-]+\.sync\.zip"$/);
    expect(response.body).toBe("PK archive");
    expect(foreign.statusCode).toBe(404);
    expect(exporter).toHaveBeenCalledWith("alice", "project", expect.any(String));
    await app.close();
  });
});
