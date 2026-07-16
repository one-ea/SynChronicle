import { createHash } from "node:crypto";
import { posix } from "node:path";
import { deflateRawSync, inflateRawSync } from "node:zlib";
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
const ReferenceSchema = z.object({ type: z.string().min(1).max(128), path: z.string().min(1), version: z.number().int().positive() });
const ManifestSchema = z.object({
  format: z.literal("synchronicle-project"),
  version: z.literal(1),
  project: z.object({ title: z.string().min(1).max(256), version: z.number().int().positive() }).strict(),
  run: z.object({ id: z.string().uuid(), status: z.literal("completed"), completedAt: z.string().datetime() }).strict(),
  checkpoint: z.object({ id: z.string().uuid(), version: z.number().int().positive(), projectVersion: z.number().int().positive(), taskFingerprint: z.string().min(1).max(512) }).strict(),
  exportedAt: z.string().datetime(),
  chapters: z.array(ChapterSchema).max(10_000),
  artifacts: z.array(ArtifactSchema).max(10_000),
  planning: z.array(ReferenceSchema).max(10_000),
  reviews: z.array(ReferenceSchema).max(10_000),
}).strict().superRefine((manifest, context) => {
  unique(manifest.chapters.map((entry) => String(entry.sequence)), "chapter sequence", context);
  unique(manifest.artifacts.map((entry) => entry.type), "artifact type", context);
  unique(manifest.planning.map((entry) => entry.type), "planning type", context);
  unique(manifest.reviews.map((entry) => entry.type), "review type", context);
  unique([...manifest.chapters, ...manifest.artifacts].map((entry) => safeArchivePath(entry.path)), "normalized path", context);
  const artifactKeys = new Set(manifest.artifacts.map((entry) => `${entry.type}\0${safeArchivePath(entry.path)}\0${entry.version}`));
  for (const [label, references] of [["planning", manifest.planning], ["review", manifest.reviews]] as const) for (const reference of references) if (!artifactKeys.has(`${reference.type}\0${safeArchivePath(reference.path)}\0${reference.version}`)) context.addIssue({ code: z.ZodIssueCode.custom, message: `${label} reference does not match an artifact` });
  if (manifest.checkpoint.projectVersion !== manifest.project.version) context.addIssue({ code: z.ZodIssueCode.custom, message: "Checkpoint project version mismatch" });
});

export type ProjectArchiveManifest = z.infer<typeof ManifestSchema>;
export type ArchiveSource = Buffer | Uint8Array | AsyncIterable<Uint8Array>;

export class ArchiveValidationError extends Error {
  readonly statusCode: number = 400;
}
export class ArchiveLimitError extends ArchiveValidationError {
  constructor(message: string, override readonly statusCode: 413 | 422) { super(message); }
}

export function safeArchivePath(path: string): string {
  const normalized = posix.normalize(path.replaceAll("\\", "/"));
  if (!path || path.includes("\0") || normalized.startsWith("/") || normalized === ".." || normalized.startsWith("../") || /^[a-zA-Z]:/.test(path)) {
    throw new ArchiveValidationError(`Unsafe archive path: ${path}`);
  }
  return normalized;
}

interface ArchiveLimits { maxBytes?: number; maxEntryBytes?: number; maxEntries?: number; maxCompressionRatio?: number }
interface ArchiveWriteOptions extends ArchiveLimits { compression?: "stored" | "deflate"; dataDescriptor?: boolean }
export interface ArchiveEntrySource { path: string; content: Uint8Array }

export function createProjectArchive(manifestInput: ProjectArchiveManifest, files: ReadonlyMap<string, Uint8Array>, options: ArchiveWriteOptions = {}): Buffer {
  rejectSensitiveKeys(manifestInput);
  const parsed = ManifestSchema.safeParse(manifestInput);
  if (!parsed.success) throw new ArchiveValidationError(parsed.error.issues.map((issue) => issue.message).join("; "));
  const manifest = parsed.data;
  const expected = new Set([...manifest.chapters, ...manifest.artifacts].map((entry) => safeArchivePath(entry.path)));
  const entries: Array<[string, Buffer]> = [["manifest.json", Buffer.from(JSON.stringify(manifest))]];
  for (const [rawPath, value] of files) {
    const path = safeArchivePath(rawPath);
    if (!expected.has(path)) throw new ArchiveValidationError(`Unindexed archive entry: ${path}`);
    const indexed = [...manifest.artifacts].find((entry) => safeArchivePath(entry.path) === path);
    if (indexed) assertArtifactSafe(indexed.encoding, Buffer.from(value).toString("utf8"));
    entries.push([path, Buffer.from(value)]);
  }
  if (files.size !== expected.size) throw new ArchiveValidationError("Archive index does not match files");
  return zip(entries, options);
}

export async function parseProjectArchive(source: ArchiveSource, options: ArchiveLimits = {}): Promise<{ manifest: ProjectArchiveManifest; files: Map<string, Buffer> }> {
  const data = await boundedBuffer(source, options.maxBytes ?? DEFAULT_MAX_ARCHIVE_BYTES);
  const entries = unzip(data, options);
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
    if ("encoding" in entry) assertArtifactSafe(entry.encoding, content.toString("utf8"));
    files.set(path, content);
  }
  for (const path of entries.keys()) if (path !== "manifest.json" && !files.has(path)) throw new ArchiveValidationError(`Unindexed archive entry: ${path}`);
  return { manifest, files };
}

export async function* streamProjectArchive(manifestInput: ProjectArchiveManifest, sources: AsyncIterable<ArchiveEntrySource>, options: ArchiveWriteOptions = {}): AsyncIterable<Uint8Array> {
  rejectSensitiveKeys(manifestInput);
  const parsed = ManifestSchema.safeParse(manifestInput);
  if (!parsed.success) throw new ArchiveValidationError(parsed.error.issues.map((issue) => issue.message).join("; "));
  const expected = new Set([...parsed.data.chapters, ...parsed.data.artifacts].map((entry) => safeArchivePath(entry.path)));
  const central: Buffer[] = [];
  let offset = 0, total = 0, count = 0;
  const emit = function* (chunks: Buffer[]) { for (const chunk of chunks) { total += chunk.length; if (total > (options.maxBytes ?? DEFAULT_MAX_ARCHIVE_BYTES)) throw new ArchiveLimitError("Archive size limit exceeded", 413); yield chunk; } };
  const all = (async function* () { yield { path: "manifest.json", content: Buffer.from(JSON.stringify(parsed.data)) }; for await (const source of sources) yield source; })();
  for await (const source of all) {
    const path = safeArchivePath(source.path), content = Buffer.from(source.content);
    if (path !== "manifest.json" && !expected.delete(path)) throw new ArchiveValidationError(`Duplicate or unindexed archive entry: ${path}`);
    if (content.length > (options.maxEntryBytes ?? DEFAULT_MAX_ENTRY_BYTES)) throw new ArchiveLimitError("Archive entry size limit exceeded", 422);
    if (++count > (options.maxEntries ?? 10_001)) throw new ArchiveValidationError("Archive entry count limit exceeded");
    const encoded = encodeEntry(path, content, offset, options);
    for (const chunk of emit(encoded.local)) yield chunk;
    central.push(encoded.central); offset += encoded.local.reduce((sum, chunk) => sum + chunk.length, 0);
  }
  if (expected.size) throw new ArchiveValidationError("Archive index does not match files");
  const centralOffset = offset, centralData = Buffer.concat(central), end = eocd(count, centralData.length, centralOffset);
  for (const chunk of emit([centralData, end])) yield chunk;
}

export function assertProjectArchiveSize(manifest: ProjectArchiveManifest, entries: Array<{ path: string; size: number }>, limits: { maxBytes: number; maxEntryBytes: number }): number {
  const all = [{ path: "manifest.json", size: Buffer.byteLength(JSON.stringify(manifest)) }, ...entries];
  let total = 22;
  for (const entry of all) {
    if (entry.size > limits.maxEntryBytes) throw new ArchiveLimitError("Archive entry size limit exceeded", 422);
    const nameBytes = Buffer.byteLength(safeArchivePath(entry.path));
    total += 30 + nameBytes + entry.size + 16 + 46 + nameBytes;
    if (total > limits.maxBytes) throw new ArchiveLimitError("Archive size limit exceeded", 413);
  }
  return total;
}

async function boundedBuffer(source: ArchiveSource, maxBytes: number): Promise<Buffer> {
  if (source instanceof Uint8Array) {
    if (source.byteLength > maxBytes) throw new ArchiveLimitError("Archive size limit exceeded", 413);
    return Buffer.from(source);
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of source) {
    size += chunk.byteLength;
    if (size > maxBytes) throw new ArchiveLimitError("Archive size limit exceeded", 413);
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

export function assertArtifactSafe(encoding: "text" | "json", content: string): void {
  if (encoding === "json") {
    let value: unknown;
    try { value = JSON.parse(content); } catch { throw new ArchiveValidationError("JSON artifact is invalid"); }
    rejectSensitiveKeys(value, "artifact");
    return;
  }
  const assignment = /^\s*(?:export\s+)?(?:const\s+)?(?:api[-_]?key|secret|password|credential|access[-_]?token)\s*[:=]\s*\S{8,}/im;
  const bearer = /\b(?:authorization\s*:\s*)?bearer\s+[a-z0-9._~+\/-]{20,}/i;
  if (assignment.test(content) || bearer.test(content)) throw new ArchiveValidationError("Sensitive text artifact content is forbidden");
}

function unzip(data: Buffer, options: ArchiveLimits): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  const endOffset = findSignatureReverse(data, 0x06054b50, Math.max(0, data.length - 65_557));
  if (endOffset < 0 || endOffset + 22 > data.length) throw new ArchiveValidationError("ZIP central directory is missing");
  if (data.readUInt16LE(endOffset + 4) !== 0 || data.readUInt16LE(endOffset + 6) !== 0) throw new ArchiveValidationError("Multi-disk ZIP is unsupported");
  const diskEntries = data.readUInt16LE(endOffset + 8), entryCount = data.readUInt16LE(endOffset + 10), centralSize = data.readUInt32LE(endOffset + 12), centralOffset = data.readUInt32LE(endOffset + 16);
  if ([entryCount, centralSize, centralOffset].includes(0xffff) || [centralSize, centralOffset].includes(0xffffffff)) throw new ArchiveValidationError("ZIP64 is unsupported");
  if (diskEntries !== entryCount || entryCount > (options.maxEntries ?? 10_001)) throw new ArchiveValidationError("ZIP entry count is invalid or exceeds the entry count limit");
  if (centralOffset + centralSize !== endOffset) throw new ArchiveValidationError("ZIP central directory size is invalid");
  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index++) {
    if (cursor + 46 > endOffset || data.readUInt32LE(cursor) !== 0x02014b50) throw new ArchiveValidationError("Invalid central directory entry");
    const flags = data.readUInt16LE(cursor + 8), method = data.readUInt16LE(cursor + 10), crc = data.readUInt32LE(cursor + 16), compressedSize = data.readUInt32LE(cursor + 20), size = data.readUInt32LE(cursor + 24);
    const nameLength = data.readUInt16LE(cursor + 28), extraLength = data.readUInt16LE(cursor + 30), commentLength = data.readUInt16LE(cursor + 32), disk = data.readUInt16LE(cursor + 34), external = data.readUInt32LE(cursor + 38), localOffset = data.readUInt32LE(cursor + 42);
    if (flags & 1) throw new ArchiveValidationError("Encrypted ZIP entries are forbidden");
    if (disk !== 0) throw new ArchiveValidationError("Multi-disk ZIP is unsupported");
    if ([compressedSize, size, localOffset].includes(0xffffffff) || hasZip64Extra(data.subarray(cursor + 46 + nameLength, cursor + 46 + nameLength + extraLength))) throw new ArchiveValidationError("ZIP64 is unsupported");
    if (method !== 0 && method !== 8) throw new ArchiveValidationError("Unsupported ZIP compression method");
    if (((external >>> 16) & 0o170000) === 0o120000) throw new ArchiveValidationError("ZIP symlink entries are forbidden");
    if (size > (options.maxEntryBytes ?? DEFAULT_MAX_ENTRY_BYTES)) throw new ArchiveLimitError("Archive entry size limit exceeded", 422);
    if (compressedSize === 0 ? size > 0 : size / compressedSize > (options.maxCompressionRatio ?? 100)) throw new ArchiveValidationError("Archive compression ratio limit exceeded");
    const centralName = data.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8"), path = safeArchivePath(centralName);
    if (files.has(path)) throw new ArchiveValidationError(`Duplicate normalized archive path: ${path}`);
    if (localOffset + 30 > centralOffset || data.readUInt32LE(localOffset) !== 0x04034b50) throw new ArchiveValidationError("Invalid local ZIP header");
    const localFlags = data.readUInt16LE(localOffset + 6), localMethod = data.readUInt16LE(localOffset + 8), localCrc = data.readUInt32LE(localOffset + 14), localCompressed = data.readUInt32LE(localOffset + 18), localSize = data.readUInt32LE(localOffset + 22), localNameLength = data.readUInt16LE(localOffset + 26), localExtraLength = data.readUInt16LE(localOffset + 28);
    if (localFlags & 1) throw new ArchiveValidationError("Encrypted ZIP entries are forbidden");
    if ([localCompressed, localSize].includes(0xffffffff)) throw new ArchiveValidationError("ZIP64 is unsupported");
    const localName = data.subarray(localOffset + 30, localOffset + 30 + localNameLength).toString("utf8");
    if (safeArchivePath(localName) !== path || localName !== centralName || localFlags !== flags || localMethod !== method) throw new ArchiveValidationError("Local and central ZIP headers disagree");
    if (!(flags & 0x08) && (localCrc !== crc || localCompressed !== compressedSize || localSize !== size)) throw new ArchiveValidationError("Local and central ZIP sizes or CRC disagree");
    const bodyOffset = localOffset + 30 + localNameLength + localExtraLength, bodyEnd = bodyOffset + compressedSize;
    if (bodyEnd > centralOffset) throw new ArchiveValidationError("Truncated ZIP entry");
    const content = method === 8 ? inflateRawSync(data.subarray(bodyOffset, bodyEnd)) : Buffer.from(data.subarray(bodyOffset, bodyEnd));
    if (content.length !== size || crc32(content) !== crc) throw new ArchiveValidationError("ZIP entry size or CRC checksum mismatch");
    if (flags & 0x08) validateDescriptor(data, bodyEnd, crc, compressedSize, size);
    files.set(path, content);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (cursor !== endOffset) throw new ArchiveValidationError("ZIP central directory length mismatch");
  return files;
}

function zip(files: Array<[string, Buffer]>, options: ArchiveWriteOptions): Buffer {
  const local: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of files) { const encoded = encodeEntry(name, data, offset, options); local.push(...encoded.local); central.push(encoded.central); offset += encoded.local.reduce((sum, chunk) => sum + chunk.length, 0); }
  const centralData = Buffer.concat(central), output = Buffer.concat([...local, centralData, eocd(files.length, centralData.length, offset)]);
  if (output.length > (options.maxBytes ?? DEFAULT_MAX_ARCHIVE_BYTES)) throw new ArchiveLimitError("Archive size limit exceeded", 413);
  return output;
}

function encodeEntry(rawName: string, data: Buffer, offset: number, options: ArchiveWriteOptions) {
  const name = Buffer.from(safeArchivePath(rawName)), method = options.compression === "deflate" ? 8 : 0, compressed = method === 8 ? deflateRawSync(data) : data, checksum = crc32(data), descriptor = options.dataDescriptor === true, flags = descriptor ? 0x08 : 0;
  if (data.length > (options.maxEntryBytes ?? DEFAULT_MAX_ENTRY_BYTES)) throw new ArchiveLimitError("Archive entry size limit exceeded", 422);
  const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(flags, 6); header.writeUInt16LE(method, 8); header.writeUInt32LE(descriptor ? 0 : checksum, 14); header.writeUInt32LE(descriptor ? 0 : compressed.length, 18); header.writeUInt32LE(descriptor ? 0 : data.length, 22); header.writeUInt16LE(name.length, 26);
  const dataDescriptor = descriptor ? Buffer.alloc(16) : Buffer.alloc(0); if (descriptor) { dataDescriptor.writeUInt32LE(0x08074b50, 0); dataDescriptor.writeUInt32LE(checksum, 4); dataDescriptor.writeUInt32LE(compressed.length, 8); dataDescriptor.writeUInt32LE(data.length, 12); }
  const centralHeader = Buffer.alloc(46); centralHeader.writeUInt32LE(0x02014b50, 0); centralHeader.writeUInt16LE(0x0314, 4); centralHeader.writeUInt16LE(20, 6); centralHeader.writeUInt16LE(flags, 8); centralHeader.writeUInt16LE(method, 10); centralHeader.writeUInt32LE(checksum, 16); centralHeader.writeUInt32LE(compressed.length, 20); centralHeader.writeUInt32LE(data.length, 24); centralHeader.writeUInt16LE(name.length, 28); centralHeader.writeUInt32LE((0o100644 << 16) >>> 0, 38); centralHeader.writeUInt32LE(offset, 42);
  return { local: [header, name, compressed, dataDescriptor], central: Buffer.concat([centralHeader, name]) };
}

function eocd(count: number, centralSize: number, centralOffset: number) { const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10); end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(centralOffset, 16); return end; }
function validateDescriptor(data: Buffer, offset: number, crc: number, compressed: number, size: number) { const signature = data.readUInt32LE(offset) === 0x08074b50, start = offset + (signature ? 4 : 0); if (start + 12 > data.length || data.readUInt32LE(start) !== crc || data.readUInt32LE(start + 4) !== compressed || data.readUInt32LE(start + 8) !== size) throw new ArchiveValidationError("ZIP data descriptor mismatch"); }
function hasZip64Extra(extra: Buffer) { for (let offset = 0; offset + 4 <= extra.length;) { const id = extra.readUInt16LE(offset), size = extra.readUInt16LE(offset + 2); if (id === 1) return true; offset += 4 + size; } return false; }
function findSignatureReverse(data: Buffer, signature: number, start: number) { for (let offset = data.length - 4; offset >= start; offset--) if (data.readUInt32LE(offset) === signature) return offset; return -1; }
function unique(values: string[], label: string, context: z.RefinementCtx) { const seen = new Set<string>(); for (const value of values) { if (seen.has(value)) { context.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate ${label}` }); return; } seen.add(value); } }

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
