import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { importExportRoutes } from "./importExportRoutes.js";

async function appFor(userId = "alice") {
  const app = Fastify({ genReqId: () => randomUUID() });
  app.decorateRequest("auth");
  app.decorate("authenticateRequest", async (request) => { request.auth = { userId, role: "user", sessionId: "session" }; });
  const importer = vi.fn(async () => ({ project: { id: "new", title: "Imported" } }));
  const exporter = vi.fn((_userId: string, projectId: string) => projectId === "foreign" ? null : (async function* () { yield Buffer.from("PK "); yield Buffer.from("archive"); })());
  const auditFailure = vi.fn(async () => undefined);
  await app.register(importExportRoutes, { prefix: "/api/projects", importer, exporter, auditFailure, maxArchiveBytes: 32 });
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
    const response = await app.inject({ method: "GET", url: "/api/projects/project/export?version=3" });
    const foreign = await app.inject({ method: "GET", url: "/api/projects/foreign/export?version=3" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/zip");
    expect(response.headers["content-disposition"]).toMatch(/^attachment; filename="project-[a-zA-Z0-9-]+\.sync\.zip"$/);
    expect(response.body).toBe("PK archive");
    expect(foreign.statusCode).toBe(404);
    expect(exporter).toHaveBeenCalledWith("alice", "project", 3, expect.any(String));
    await app.close();
  });

  it("returns version conflicts before streaming and preserves the original error when failure audit fails", async () => {
    const app = Fastify({ genReqId: () => randomUUID() });
    app.decorateRequest("auth");
    app.decorate("authenticateRequest", async (request) => { request.auth = { userId: "alice", role: "user", sessionId: "session" }; });
    const original = Object.assign(new Error("stable snapshot unavailable"), { statusCode: 409, code: "unstable" });
    const auditFailure = vi.fn(async () => { throw new Error("audit unavailable"); });
    await app.register(importExportRoutes, { prefix: "/api/projects", importer: vi.fn(), exporter: () => (async function* () { throw original; })(), auditFailure });
    await app.after();
    const response = await app.inject({ method: "GET", url: "/api/projects/p1/export?version=2" });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "Stable project version unavailable" });
    expect(auditFailure).toHaveBeenCalledWith(expect.objectContaining({ action: "project.export", result: "conflict" }));
    await app.close();
  });
});
