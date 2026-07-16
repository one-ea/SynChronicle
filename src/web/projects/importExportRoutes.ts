import { Readable } from "node:stream";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { ArchiveSource } from "../../migration/archive.js";

interface ImportResult { project: unknown }
interface ImportExportRoutesOptions {
  importer(userId: string, source: ArchiveSource, requestId: string): Promise<ImportResult>;
  exporter(userId: string, projectId: string, expectedVersion: number, requestId: string): AsyncIterable<Uint8Array> | null;
  preflight(userId: string, projectId: string, expectedVersion: number): Promise<"ok" | "missing" | "conflict">;
  auditFailure?(event: { actorId: string; action: "project.import" | "project.export"; targetId: string | null; result: "invalid" | "conflict" | "not_found" | "error"; requestId: string; metadata?: Record<string, unknown> }): Promise<void>;
  maxArchiveBytes?: number;
}

const QuerySchema = z.object({ filename: z.string().min(1).max(255) });
const ParamsSchema = z.object({ projectId: z.string().min(1).max(128) });
const ExportQuerySchema = z.object({ version: z.coerce.number().int().positive() });
const mimeTypes = new Set(["application/zip", "application/x-zip-compressed"]);

export const importExportRoutes: FastifyPluginAsync<ImportExportRoutesOptions> = async (app, options) => {
  const maxBytes = options.maxArchiveBytes ?? 50 * 1024 * 1024;
  for (const type of mimeTypes) app.addContentTypeParser(type, (_request, payload, done) => done(null, payload));
  app.addHook("preHandler", app.authenticateRequest);

  app.post("/import", async (request, reply) => {
    const query = QuerySchema.safeParse(request.query);
    const contentType = String(request.headers["content-type"] ?? "").split(";", 1)[0]!.toLowerCase();
    if (!query.success || !query.data.filename.toLowerCase().endsWith(".sync.zip") || !mimeTypes.has(contentType)) { await auditRejected(options, request, "project.import", null, "invalid"); return reply.code(415).send({ error: "Unsupported project archive" }); }
    const contentLength = Number(request.headers["content-length"] ?? 0);
    if (contentLength > maxBytes) { await auditRejected(options, request, "project.import", null, "invalid", { reason: "size_limit" }); return reply.code(413).send({ error: "Project archive is too large" }); }
    const source = request.body as AsyncIterable<Uint8Array>;
    try {
      const result = await options.importer(request.auth.userId, limited(source, maxBytes), request.id);
      return reply.code(201).send({ ...result, progress: 100 });
    } catch (error) {
      if (error instanceof UploadLimitError) { await auditRejected(options, request, "project.import", null, "invalid", { reason: "size_limit" }); return reply.code(413).send({ error: "Project archive is too large" }); }
      await auditRejected(options, request, "project.import", null, "error");
      throw error;
    }
  });

  app.get("/:projectId/export-metadata", async (request, reply) => {
    const params = ParamsSchema.safeParse(request.params), query = ExportQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) { await auditRejected(options, request, "project.export", params.success ? params.data.projectId : null, "invalid", { phase: "metadata" }); return reply.code(400).send({ error: "Invalid export request" }); }
    const result = await options.preflight(request.auth.userId, params.data.projectId, query.data.version);
    if (result === "missing") { await auditRejected(options, request, "project.export", params.data.projectId, "not_found", { phase: "metadata" }); return reply.code(404).send({ error: "Project not found" }); }
    if (result === "conflict") { await auditRejected(options, request, "project.export", params.data.projectId, "conflict", { phase: "metadata" }); return reply.code(409).send({ error: "Stable project version unavailable" }); }
    return { downloadUrl: `/api/projects/${encodeURIComponent(params.data.projectId)}/export?version=${query.data.version}` };
  });

  app.get("/:projectId/export", async (request, reply) => {
    const params = ParamsSchema.safeParse(request.params);
    const query = ExportQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) { await auditRejected(options, request, "project.export", params.success ? params.data.projectId : null, "invalid"); return reply.code(400).send({ error: "Invalid export request" }); }
    const archive = options.exporter(request.auth.userId, params.data.projectId, query.data.version, request.id);
    if (!archive) { await auditRejected(options, request, "project.export", params.data.projectId, "not_found"); return reply.code(404).send({ error: "Project not found" }); }
    const iterator = archive[Symbol.asyncIterator]();
    let first: IteratorResult<Uint8Array>;
    try { first = await iterator.next(); }
    catch (error) {
      const status = error && typeof error === "object" && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : 500;
      if (status === 409) return reply.code(409).send({ error: "Stable project version unavailable" });
      if (status === 413) return reply.code(413).send({ error: "Project archive is too large" });
      if (status === 422) return reply.code(422).send({ error: "Project entry is too large" });
      if (status === 404) return reply.code(404).send({ error: "Project not found" });
      throw error;
    }
    const safeId = params.data.projectId.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 64) || "project";
    reply.header("content-type", "application/zip");
    reply.header("content-disposition", `attachment; filename="project-${safeId}.sync.zip"`);
    return reply.send(Readable.from(prepend(first, iterator)));
  });
};

class UploadLimitError extends Error {}

async function* limited(source: AsyncIterable<Uint8Array>, maxBytes: number): AsyncIterable<Uint8Array> {
  let size = 0;
  for await (const value of source) {
    size += value.byteLength;
    if (size > maxBytes) throw new UploadLimitError();
    yield value;
  }
}

async function* prepend(first: IteratorResult<Uint8Array>, iterator: AsyncIterator<Uint8Array>) { if (!first.done) yield first.value; while (true) { const next = await iterator.next(); if (next.done) return; yield next.value; } }
async function auditRejected(options: ImportExportRoutesOptions, request: { auth: { userId: string }; id: string }, action: "project.import" | "project.export", targetId: string | null, result: "invalid" | "conflict" | "not_found" | "error", metadata?: Record<string, unknown>) { try { await options.auditFailure?.({ actorId: request.auth.userId, action, targetId, result, requestId: request.id, ...(metadata ? { metadata } : {}) }); } catch { /* Failure auditing must preserve the original response/error. */ } }
