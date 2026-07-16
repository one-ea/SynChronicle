import { Readable } from "node:stream";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { ArchiveSource } from "../../migration/archive.js";

interface ImportResult { project: unknown }
interface ImportExportRoutesOptions {
  importer(userId: string, source: ArchiveSource, requestId: string): Promise<ImportResult>;
  exporter(userId: string, projectId: string, requestId: string): Promise<Buffer | null>;
  maxArchiveBytes?: number;
}

const QuerySchema = z.object({ filename: z.string().min(1).max(255) });
const ParamsSchema = z.object({ projectId: z.string().min(1).max(128) });
const mimeTypes = new Set(["application/zip", "application/x-zip-compressed"]);

export const importExportRoutes: FastifyPluginAsync<ImportExportRoutesOptions> = async (app, options) => {
  const maxBytes = options.maxArchiveBytes ?? 50 * 1024 * 1024;
  for (const type of mimeTypes) app.addContentTypeParser(type, (_request, payload, done) => done(null, payload));
  app.addHook("preHandler", app.authenticateRequest);

  app.post("/import", async (request, reply) => {
    const query = QuerySchema.safeParse(request.query);
    const contentType = String(request.headers["content-type"] ?? "").split(";", 1)[0]!.toLowerCase();
    if (!query.success || !query.data.filename.toLowerCase().endsWith(".sync.zip") || !mimeTypes.has(contentType)) return reply.code(415).send({ error: "Unsupported project archive" });
    const contentLength = Number(request.headers["content-length"] ?? 0);
    if (contentLength > maxBytes) return reply.code(413).send({ error: "Project archive is too large" });
    const source = request.body as AsyncIterable<Uint8Array>;
    try {
      const result = await options.importer(request.auth.userId, limited(source, maxBytes), request.id);
      return reply.code(201).send({ ...result, progress: 100 });
    } catch (error) {
      if (error instanceof UploadLimitError) return reply.code(413).send({ error: "Project archive is too large" });
      throw error;
    }
  });

  app.get("/:projectId/export", async (request, reply) => {
    const params = ParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: "Project not found" });
    const archive = await options.exporter(request.auth.userId, params.data.projectId, request.id);
    if (!archive) return reply.code(404).send({ error: "Project not found" });
    const safeId = params.data.projectId.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 64) || "project";
    reply.header("content-type", "application/zip");
    reply.header("content-disposition", `attachment; filename="project-${safeId}.sync.zip"`);
    reply.header("content-length", String(archive.length));
    return reply.send(Readable.from(chunk(archive)));
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

function* chunk(value: Buffer, size = 64 * 1024): Iterable<Buffer> {
  for (let offset = 0; offset < value.length; offset += size) yield value.subarray(offset, offset + size);
}
