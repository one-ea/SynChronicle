import { createHash } from "node:crypto";
import { posix } from "node:path";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { z } from "zod";

export const DEFAULT_MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
export const DEFAULT_MAX_ENTRY_BYTES = 10 * 1024 * 1024;
export const DEFAULT_MAX_TOTAL_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
export const DEFAULT_MAX_ENTRIES = 1_000;

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

interface ArchiveLimits { maxBytes?: number; maxEntryBytes?: number; maxEntries?: number; maxCompressionRatio?: number; maxTotalUncompressedBytes?: number }
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
    if (++count > (options.maxEntries ?? DEFAULT_MAX_ENTRIES)) throw new ArchiveValidationError("Archive entry count limit exceeded");
    const encoded = encodeEntry(path, content, offset, options);
    for (const chunk of emit(encoded.local)) yield chunk;
    central.push(encoded.central); offset += encoded.local.reduce((sum, chunk) => sum + chunk.length, 0);
  }
  if (expected.size) throw new ArchiveValidationError("Archive index does not match files");
  const centralOffset = offset, centralData = Buffer.concat(central), end = eocd(count, centralData.length, centralOffset);
  for (const chunk of emit([centralData, end])) yield chunk;
}

export function assertProjectArchiveSize(manifest: ProjectArchiveManifest, entries: Array<{ path: string; size: number }>, limits: { maxBytes: number; maxEntryBytes: number; maxEntries?: number }): number {
  const all = [{ path: "manifest.json", size: Buffer.byteLength(JSON.stringify(manifest)) }, ...entries];
  if (all.length > (limits.maxEntries ?? DEFAULT_MAX_ENTRIES)) throw new ArchiveValidationError("Archive entry count limit exceeded");
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
  const sensitiveKey = /^(?:(?:[a-z0-9]+[-_])*api[-_]key|client[-_]secret|refresh[-_]token|private[-_]key|database[-_]url|authorization|access[-_]token|auth[-_]token|github[-_]token|token|secret|password|credential)$/i;
  const suspiciousKey = /(?:^|[-_])(?:api|auth|token|secret|password|credential|key)(?:$|[-_])/i;
  const assignment = /^\s*(?:export\s+)?(?:(?:const|let|var)\s+)?["']?([a-z0-9_-]+)["']?\s*[:=]\s*(.*?)\s*[,;]?\s*$/i;
  for (const line of content.split(/\r?\n/)) {
    const match = assignment.exec(line);
    if (!match?.[1]) continue;
    const value = stripAssignmentQuotes(match[2] ?? "");
    if (sensitiveKey.test(match[1]) || (suspiciousKey.test(match[1]) && isLikelySecret(value))) throw new ArchiveValidationError("Sensitive text artifact content is forbidden");
  }
}

function stripAssignmentQuotes(value: string): string { const trimmed = value.trim(); return trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith("`") && trimmed.endsWith("`"))) ? trimmed.slice(1, -1) : trimmed; }
function isLikelySecret(value: string): boolean {
  if (/^(?:sk-(?:proj-)?|gh[pousr]_|github_pat_|glpat-|xox[baprs]-|AKIA|AIza|eyJ|-----BEGIN(?:_|\s)|(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/|(?:basic|bearer)\s+)/i.test(value)) return true;
  if (value.length < 12 || /\s/.test(value)) return false;
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) { const probability = count / value.length; entropy -= probability * Math.log2(probability); }
  return value.length >= 20 && entropy >= 3.2;
}

function unzip(data: Buffer, options: ArchiveLimits): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  const endOffset = findValidEocd(data);
  if (endOffset < 0 || endOffset + 22 > data.length) throw new ArchiveValidationError("ZIP central directory is missing");
  const eocdCommentLength = data.readUInt16LE(endOffset + 20);
  if (endOffset + 22 + eocdCommentLength !== data.length) throw new ArchiveValidationError("EOCD comment length does not match the archive boundary; trailing data is forbidden");
  if (data.readUInt16LE(endOffset + 4) !== 0 || data.readUInt16LE(endOffset + 6) !== 0) throw new ArchiveValidationError("Multi-disk ZIP is unsupported");
  const diskEntries = data.readUInt16LE(endOffset + 8), entryCount = data.readUInt16LE(endOffset + 10), centralSize = data.readUInt32LE(endOffset + 12), centralOffset = data.readUInt32LE(endOffset + 16);
  if ([entryCount, centralSize, centralOffset].includes(0xffff) || [centralSize, centralOffset].includes(0xffffffff)) throw new ArchiveValidationError("ZIP64 is unsupported");
  if (diskEntries !== entryCount || entryCount > (options.maxEntries ?? DEFAULT_MAX_ENTRIES)) throw new ArchiveValidationError("ZIP entry count is invalid or exceeds the entry count limit");
  if (centralOffset + centralSize !== endOffset) throw new ArchiveValidationError("ZIP central directory size is invalid");
  let cursor = centralOffset, declaredTotal = 0, actualTotal = 0;
  const localIntervals: Array<{ start: number; end: number }> = [];
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
    declaredTotal += size;
    if (declaredTotal > (options.maxTotalUncompressedBytes ?? DEFAULT_MAX_TOTAL_UNCOMPRESSED_BYTES)) throw new ArchiveLimitError("Archive total uncompressed size limit exceeded", 413);
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
    const remainingTotal = (options.maxTotalUncompressedBytes ?? DEFAULT_MAX_TOTAL_UNCOMPRESSED_BYTES) - actualTotal;
    const outputLimit = Math.min(size, options.maxEntryBytes ?? DEFAULT_MAX_ENTRY_BYTES, remainingTotal);
    if (method === 0 && compressedSize > outputLimit) throw new ArchiveLimitError("Stored ZIP entry actual output exceeds its declared or configured limit", outputLimit === remainingTotal ? 413 : 422);
    let content: Buffer;
    try { content = method === 8 ? inflateRawSync(data.subarray(bodyOffset, bodyEnd), { maxOutputLength: Math.max(1, outputLimit) }) : Buffer.from(data.subarray(bodyOffset, bodyEnd)); }
    catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "ERR_BUFFER_TOO_LARGE") throw new ArchiveLimitError("Archive entry actual output exceeds its declared or configured limit", outputLimit === remainingTotal ? 413 : 422); throw error; }
    actualTotal += content.length;
    if (actualTotal > (options.maxTotalUncompressedBytes ?? DEFAULT_MAX_TOTAL_UNCOMPRESSED_BYTES)) throw new ArchiveLimitError("Archive actual total uncompressed size limit exceeded", 413);
    if (content.length !== size || crc32(content) !== crc) throw new ArchiveValidationError("ZIP entry size or CRC checksum mismatch");
    const localEnd = flags & 0x08 ? validateDescriptor(data, bodyEnd, crc, compressedSize, size) : bodyEnd;
    if (localEnd > centralOffset) throw new ArchiveValidationError("Local ZIP entry overlaps the central directory");
    localIntervals.push({ start: localOffset, end: localEnd });
    files.set(path, content);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (cursor !== endOffset) throw new ArchiveValidationError("ZIP central directory length mismatch");
  localIntervals.sort((left, right) => left.start - right.start);
  let expectedOffset = 0;
  for (const interval of localIntervals) {
    if (interval.end <= interval.start) throw new ArchiveValidationError("Invalid local entry interval");
    if (interval.start < expectedOffset) throw new ArchiveValidationError("Overlapping local entry intervals are forbidden");
    if (interval.start > expectedOffset) throw new ArchiveValidationError("Gap or unindexed local entry detected in ZIP structure");
    expectedOffset = interval.end;
  }
  if (expectedOffset !== centralOffset) throw new ArchiveValidationError("Local entries do not provide continuous coverage to the central directory");
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
function validateDescriptor(data: Buffer, offset: number, crc: number, compressed: number, size: number) { if (offset + 12 > data.length) throw new ArchiveValidationError("Truncated ZIP data descriptor"); const signature = offset + 16 <= data.length && data.readUInt32LE(offset) === 0x08074b50, start = offset + (signature ? 4 : 0); if (start + 12 > data.length || data.readUInt32LE(start) !== crc || data.readUInt32LE(start + 4) !== compressed || data.readUInt32LE(start + 8) !== size) throw new ArchiveValidationError("ZIP data descriptor mismatch"); return start + 12; }
function hasZip64Extra(extra: Buffer) { for (let offset = 0; offset + 4 <= extra.length;) { const id = extra.readUInt16LE(offset), size = extra.readUInt16LE(offset + 2); if (id === 1) return true; offset += 4 + size; } return false; }
function findValidEocd(data: Buffer): number {
  const start = Math.max(0, data.length - 65_557);
  for (let offset = data.length - 22; offset >= start; offset--) {
    if (data.readUInt32LE(offset) !== 0x06054b50) continue;
    const commentLength = data.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength !== data.length) continue;
    const entryCount = data.readUInt16LE(offset + 10), centralSize = data.readUInt32LE(offset + 12), centralOffset = data.readUInt32LE(offset + 16);
    if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff || centralOffset + centralSize !== offset) continue;
    if (validCentralDirectoryShape(data, centralOffset, offset, entryCount)) return offset;
  }
  return -1;
}
function validCentralDirectoryShape(data: Buffer, start: number, end: number, count: number): boolean { let cursor = start; for (let index = 0; index < count; index++) { if (cursor + 46 > end || data.readUInt32LE(cursor) !== 0x02014b50) return false; const length = 46 + data.readUInt16LE(cursor + 28) + data.readUInt16LE(cursor + 30) + data.readUInt16LE(cursor + 32); if (cursor + length > end) return false; cursor += length; } return cursor === end; }
function unique(values: string[], label: string, context: z.RefinementCtx) { const seen = new Set<string>(); for (const value of values) { if (seen.has(value)) { context.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate ${label}` }); return; } seen.add(value); } }

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
