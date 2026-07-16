import { createHash } from "node:crypto";
import { posix } from "node:path";
import { z } from "zod";

export const DEFAULT_MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
export const DEFAULT_MAX_ENTRY_BYTES = 10 * 1024 * 1024;

const IndexedFileSchema = z.object({
  path: z.string().min(1),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  version: z.number().int().positive(),
});
const ChapterSchema = IndexedFileSchema.extend({ sequence: z.number().int().positive(), title: z.string().min(1).max(512), status: z.enum(["planned", "draft", "review", "complete"]) });
const ArtifactSchema = IndexedFileSchema.extend({ type: z.string().min(1).max(128), status: z.enum(["draft", "committed"]), encoding: z.enum(["text", "json"]) });
const ManifestSchema = z.object({
  format: z.literal("synchronicle-project"),
  version: z.literal(1),
  project: z.object({ title: z.string().min(1).max(256), version: z.number().int().positive() }).strict(),
  exportedAt: z.string().datetime(),
  chapters: z.array(ChapterSchema).max(10_000),
  artifacts: z.array(ArtifactSchema).max(10_000),
}).strict();

export type ProjectArchiveManifest = z.infer<typeof ManifestSchema>;
export type ArchiveSource = Buffer | Uint8Array | AsyncIterable<Uint8Array>;

export class ArchiveValidationError extends Error {
  readonly statusCode = 400;
}

export function safeArchivePath(path: string): string {
  const normalized = posix.normalize(path.replaceAll("\\", "/"));
  if (!path || path.includes("\0") || normalized.startsWith("/") || normalized === ".." || normalized.startsWith("../") || /^[a-zA-Z]:/.test(path)) {
    throw new ArchiveValidationError(`Unsafe archive path: ${path}`);
  }
  return normalized;
}

export function createProjectArchive(manifestInput: ProjectArchiveManifest, files: ReadonlyMap<string, Uint8Array>): Buffer {
  rejectSensitiveKeys(manifestInput);
  const manifest = ManifestSchema.parse(manifestInput);
  const expected = new Set([...manifest.chapters, ...manifest.artifacts].map((entry) => safeArchivePath(entry.path)));
  const entries: Array<[string, Buffer]> = [["manifest.json", Buffer.from(JSON.stringify(manifest))]];
  for (const [rawPath, value] of files) {
    const path = safeArchivePath(rawPath);
    if (!expected.has(path)) throw new ArchiveValidationError(`Unindexed archive entry: ${path}`);
    entries.push([path, Buffer.from(value)]);
  }
  if (files.size !== expected.size) throw new ArchiveValidationError("Archive index does not match files");
  return zip(entries);
}

export async function parseProjectArchive(source: ArchiveSource, options: { maxBytes?: number; maxEntryBytes?: number } = {}): Promise<{ manifest: ProjectArchiveManifest; files: Map<string, Buffer> }> {
  const data = await boundedBuffer(source, options.maxBytes ?? DEFAULT_MAX_ARCHIVE_BYTES);
  const entries = unzipStored(data, options.maxEntryBytes ?? DEFAULT_MAX_ENTRY_BYTES);
  const manifestData = entries.get("manifest.json");
  if (!manifestData) throw new ArchiveValidationError("Archive manifest is missing");
  let raw: unknown;
  try { raw = JSON.parse(manifestData.toString("utf8")); } catch { throw new ArchiveValidationError("Archive manifest is invalid JSON"); }
  rejectSensitiveKeys(raw);
  const parsed = ManifestSchema.safeParse(raw);
  if (!parsed.success) throw new ArchiveValidationError("Archive manifest schema is invalid");
  const manifest = parsed.data;
  const indexed = [...manifest.chapters, ...manifest.artifacts];
  const files = new Map<string, Buffer>();
  for (const entry of indexed) {
    const path = safeArchivePath(entry.path);
    const content = entries.get(path);
    if (!content) throw new ArchiveValidationError(`Archive entry is missing: ${path}`);
    const checksum = createHash("sha256").update(content).digest("hex");
    if (checksum !== entry.checksum) throw new ArchiveValidationError(`Archive checksum mismatch: ${path}`);
    files.set(path, content);
  }
  for (const path of entries.keys()) if (path !== "manifest.json" && !files.has(path)) throw new ArchiveValidationError(`Unindexed archive entry: ${path}`);
  return { manifest, files };
}

async function boundedBuffer(source: ArchiveSource, maxBytes: number): Promise<Buffer> {
  if (source instanceof Uint8Array) {
    if (source.byteLength > maxBytes) throw new ArchiveValidationError("Archive size limit exceeded");
    return Buffer.from(source);
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of source) {
    size += chunk.byteLength;
    if (size > maxBytes) throw new ArchiveValidationError("Archive size limit exceeded");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, size);
}

function rejectSensitiveKeys(value: unknown, path = "manifest"): void {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (/(secret|credential|password|token|api[-_]?key)/i.test(key)) throw new ArchiveValidationError(`Sensitive field is forbidden: ${path}.${key}`);
    rejectSensitiveKeys(child, `${path}.${key}`);
  }
}

function unzipStored(data: Buffer, maxEntryBytes: number): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 4 <= data.length && data.readUInt32LE(offset) === 0x04034b50) {
    if (offset + 30 > data.length) throw new ArchiveValidationError("Truncated ZIP header");
    const flags = data.readUInt16LE(offset + 6);
    const method = data.readUInt16LE(offset + 8);
    const compressedSize = data.readUInt32LE(offset + 18);
    const size = data.readUInt32LE(offset + 22);
    const nameLength = data.readUInt16LE(offset + 26);
    const extraLength = data.readUInt16LE(offset + 28);
    if (flags & 0x08 || method !== 0 || size !== compressedSize) throw new ArchiveValidationError("Unsupported ZIP encoding");
    if (size > maxEntryBytes) throw new ArchiveValidationError("Archive entry size limit exceeded");
    const bodyOffset = offset + 30 + nameLength + extraLength;
    const end = bodyOffset + size;
    if (end > data.length) throw new ArchiveValidationError("Truncated ZIP entry");
    const path = safeArchivePath(data.subarray(offset + 30, offset + 30 + nameLength).toString("utf8"));
    if (files.has(path)) throw new ArchiveValidationError(`Duplicate archive entry: ${path}`);
    files.set(path, data.subarray(bodyOffset, end));
    offset = end;
  }
  if (files.size === 0) throw new ArchiveValidationError("Invalid ZIP archive");
  return files;
}

function zip(files: Array<[string, Buffer]>): Buffer {
  const local: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const [rawName, data] of files) {
    const name = Buffer.from(safeArchivePath(rawName));
    const checksum = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt32LE(checksum, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
    local.push(header, name, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt32LE(checksum, 16); entry.writeUInt32LE(data.length, 20); entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(name.length, 28); entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += header.length + name.length + data.length;
  }
  const centralData = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(centralData.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralData, end]);
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
