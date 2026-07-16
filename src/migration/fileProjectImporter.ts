import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { and, asc, desc, eq, gt, inArray } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { artifacts, auditEvents, chapters, checkpoints, projects, runs } from "../db/schema/index.js";
import { assertArtifactSafe, assertProjectArchiveSize, createProjectArchive, parseProjectArchive, streamProjectArchive, type ArchiveSource, type ProjectArchiveManifest } from "./archive.js";

interface LegacyProgress { novel_name?: unknown; completed_chapters?: unknown }

export async function archiveFileProject(projectDir: string): Promise<Buffer> {
  const raw = JSON.parse(await readFile(join(projectDir, "meta", "progress.json"), "utf8")) as LegacyProgress;
  const title = typeof raw.novel_name === "string" && raw.novel_name.trim() ? raw.novel_name.trim() : basename(projectDir);
  const sequences = Array.isArray(raw.completed_chapters) ? raw.completed_chapters.filter((value): value is number => Number.isInteger(value) && value > 0) : [];
  const files = new Map<string, Buffer>();
  const chapterIndex: ProjectArchiveManifest["chapters"] = [];
  for (const sequence of sequences) {
    const body = await readFile(join(projectDir, "chapters", `${String(sequence).padStart(2, "0")}.md`));
    const path = `chapters/${sequence}.md`;
    files.set(path, body);
    chapterIndex.push({ sequence, title: body.toString("utf8").match(/^#\s+(.+)$/m)?.[1]?.trim() ?? `Chapter ${sequence}`, status: "complete", version: 1, path, checksum: sha256(body) });
  }
  const exportedAt = new Date().toISOString();
  return createProjectArchive({ format: "synchronicle-project", version: 1, project: { title, version: 1 }, run: { id: randomUUID(), status: "completed", completedAt: exportedAt }, checkpoint: { id: randomUUID(), version: 1, projectVersion: 1, taskFingerprint: "legacy-file-import" }, exportedAt, chapters: chapterIndex, artifacts: [], planning: [], reviews: [] }, files);
}

export async function importFileProject(db: Database, userId: string, projectDir: string, requestId: string = randomUUID()) {
  return importProjectArchive(db, userId, await archiveFileProject(projectDir), requestId);
}

export async function importProjectArchive(db: Database, userId: string, source: ArchiveSource, requestId: string = randomUUID()) {
  const parsed = await parseProjectArchive(source);
  return db.transaction(async (tx) => {
    const [project] = await tx.insert(projects).values({ userId, title: parsed.manifest.project.title, version: parsed.manifest.project.version }).returning();
    if (!project) throw new Error("Project insert returned no row");
    const [run] = await tx.insert(runs).values({ userId, projectId: project.id, status: "completed", startedAt: new Date(parsed.manifest.run.completedAt), completedAt: new Date(parsed.manifest.run.completedAt) }).returning();
    if (!run) throw new Error("Run insert returned no row");
    if (parsed.manifest.chapters.length) await tx.insert(chapters).values(parsed.manifest.chapters.map((entry) => ({ userId, projectId: project.id, runId: run.id, sequence: entry.sequence, title: entry.title, body: parsed.files.get(entry.path)!.toString("utf8"), status: entry.status, version: entry.version })));
    if (parsed.manifest.artifacts.length) await tx.insert(artifacts).values(parsed.manifest.artifacts.map((entry) => { const content = parsed.files.get(entry.path)!.toString("utf8"); return { userId, projectId: project.id, runId: run.id, type: entry.type, status: entry.status, version: entry.version, ...(entry.encoding === "json" ? { contentJson: JSON.parse(content) } : { contentText: content }) }; }));
    const [checkpoint] = await tx.insert(checkpoints).values({ userId, projectId: project.id, runId: run.id, version: parsed.manifest.checkpoint.version, state: {}, taskFingerprint: parsed.manifest.checkpoint.taskFingerprint, projectVersion: parsed.manifest.checkpoint.projectVersion }).returning();
    if (!checkpoint) throw new Error("Checkpoint insert returned no row");
    await tx.update(runs).set({ latestCheckpointId: checkpoint.id }).where(eq(runs.id, run.id));
    await tx.insert(auditEvents).values({ userId, action: "project.import", targetType: "project", targetId: project.id, result: "success", requestId, metadata: { formatVersion: parsed.manifest.version, chapters: parsed.manifest.chapters.length, artifacts: parsed.manifest.artifacts.length } });
    return { projectId: project.id, runId: run.id, project };
  });
}

export class ProjectArchiveExportError extends Error {
  constructor(message: string, readonly statusCode: 404 | 409 | 413 | 422, readonly code: string) { super(message); }
}

export function exportDatabaseProject(db: Database, userId: string, projectId: string, expectedVersion: number, requestId: string = randomUUID(), limits: { maxBytes?: number; maxEntryBytes?: number; pageSize?: number } = {}): AsyncIterable<Uint8Array> {
  const channel = new BackpressureChannel();
  const produce = async () => db.transaction(async (tx) => {
    const [project] = await tx.select().from(projects).where(and(eq(projects.userId, userId), eq(projects.id, projectId))).limit(1);
    if (!project) throw new ProjectArchiveExportError("Project not found", 404, "missing");
    if (project.version !== expectedVersion) throw new ProjectArchiveExportError("Project version conflict", 409, "version_conflict");
    const [run] = await tx.select().from(runs).where(and(eq(runs.userId, userId), eq(runs.projectId, projectId), eq(runs.status, "completed"))).orderBy(desc(runs.completedAt), desc(runs.updatedAt)).limit(1);
    if (!run?.completedAt || !run.latestCheckpointId) throw new ProjectArchiveExportError("Stable completed run unavailable", 409, "unstable_run");
    const [checkpoint] = await tx.select().from(checkpoints).where(and(eq(checkpoints.userId, userId), eq(checkpoints.projectId, projectId), eq(checkpoints.runId, run.id), eq(checkpoints.id, run.latestCheckpointId))).limit(1);
    if (!checkpoint || checkpoint.projectVersion !== project.version) throw new ProjectArchiveExportError("Stable checkpoint unavailable", 409, "checkpoint_mismatch");
    const chapterIndex: ProjectArchiveManifest["chapters"] = [];
    const artifactIndex: ProjectArchiveManifest["artifacts"] = [];
    const pageSize = limits.pageSize ?? 100;
    const selectedChapters = new Map<number, { id: string; path: string; size: number }>();
    let chapterCursor = "00000000-0000-0000-0000-000000000000";
    while (true) {
      const page = await tx.select({ id: chapters.id, sequence: chapters.sequence, title: chapters.title, body: chapters.body, status: chapters.status, version: chapters.version }).from(chapters).where(and(eq(chapters.userId, userId), eq(chapters.projectId, projectId), eq(chapters.runId, run.id), gt(chapters.id, chapterCursor))).orderBy(asc(chapters.id)).limit(pageSize);
      for (const row of page) { const current = chapterIndex.find((entry) => entry.sequence === row.sequence); if (!current || row.version > current.version) { const body = Buffer.from(row.body), path = `chapters/${row.sequence}.md`, entry = { sequence: row.sequence, title: row.title, status: row.status, version: row.version, path, checksum: sha256(body) }; if (current) chapterIndex.splice(chapterIndex.indexOf(current), 1, entry); else chapterIndex.push(entry); selectedChapters.set(row.sequence, { id: row.id, path, size: body.length }); } }
      if (page.length < pageSize) break; chapterCursor = page.at(-1)!.id;
    }
    const selectedArtifacts = new Map<string, { id: string; path: string; encoding: "text" | "json"; size: number }>();
    let artifactCursor = "00000000-0000-0000-0000-000000000000";
    while (true) {
      const page = await tx.select({ id: artifacts.id, type: artifacts.type, contentJson: artifacts.contentJson, contentText: artifacts.contentText, status: artifacts.status, version: artifacts.version }).from(artifacts).where(and(eq(artifacts.userId, userId), eq(artifacts.projectId, projectId), eq(artifacts.runId, run.id), gt(artifacts.id, artifactCursor))).orderBy(asc(artifacts.id)).limit(pageSize);
      for (const row of page) { const current = artifactIndex.find((entry) => entry.type === row.type); if (!current || row.version > current.version) { const encoding = row.contentJson === null ? "text" as const : "json" as const, text = encoding === "json" ? JSON.stringify(row.contentJson) : row.contentText ?? ""; assertArtifactSafe(encoding, text); const body = Buffer.from(text), path = `artifacts/${row.id}.${encoding === "json" ? "json" : "txt"}`, entry = { type: row.type, status: row.status, version: row.version, encoding, path, checksum: sha256(body) }; if (current) artifactIndex.splice(artifactIndex.indexOf(current), 1, entry); else artifactIndex.push(entry); selectedArtifacts.set(row.type, { id: row.id, path, encoding, size: body.length }); } }
      if (page.length < pageSize) break; artifactCursor = page.at(-1)!.id;
    }
    chapterIndex.sort((a, b) => a.sequence - b.sequence); artifactIndex.sort((a, b) => a.type.localeCompare(b.type));
    const planning = artifactIndex.filter((entry) => /(?:plan|outline|compass)/i.test(entry.type)).map(({ type, path, version }) => ({ type, path, version }));
    const reviews = artifactIndex.filter((entry) => /review/i.test(entry.type)).map(({ type, path, version }) => ({ type, path, version }));
    const manifest: ProjectArchiveManifest = { format: "synchronicle-project", version: 1, project: { title: project.title, version: project.version }, run: { id: run.id, status: "completed", completedAt: run.completedAt.toISOString() }, checkpoint: { id: checkpoint.id, version: checkpoint.version, projectVersion: checkpoint.projectVersion, taskFingerprint: checkpoint.taskFingerprint }, exportedAt: new Date().toISOString(), chapters: chapterIndex, artifacts: artifactIndex, planning, reviews };
    assertProjectArchiveSize(manifest, [...selectedChapters.values(), ...selectedArtifacts.values()].map(({ path, size }) => ({ path, size })), { maxBytes: limits.maxBytes ?? 100 * 1024 * 1024, maxEntryBytes: limits.maxEntryBytes ?? 10 * 1024 * 1024 });
    await tx.insert(auditEvents).values({ userId, action: "project.export", targetType: "project", targetId: project.id, result: "success", requestId, metadata: { formatVersion: 1, chapters: chapterIndex.length, artifacts: artifactIndex.length } });
    async function* sources() {
      for (let offset = 0; offset < selectedChapters.size; offset += pageSize) { const selected = [...selectedChapters.values()].slice(offset, offset + pageSize), rows = await tx.select({ id: chapters.id, body: chapters.body }).from(chapters).where(inArray(chapters.id, selected.map((entry) => entry.id))); const paths = new Map(selected.map((entry) => [entry.id, entry.path])); for (const row of rows) yield { path: paths.get(row.id)!, content: Buffer.from(row.body) }; }
      for (let offset = 0; offset < selectedArtifacts.size; offset += pageSize) { const selected = [...selectedArtifacts.values()].slice(offset, offset + pageSize), rows = await tx.select({ id: artifacts.id, contentJson: artifacts.contentJson, contentText: artifacts.contentText }).from(artifacts).where(inArray(artifacts.id, selected.map((entry) => entry.id))); const meta = new Map(selected.map((entry) => [entry.id, entry])); for (const row of rows) { const entry = meta.get(row.id)!; yield { path: entry.path, content: Buffer.from(entry.encoding === "json" ? JSON.stringify(row.contentJson) : row.contentText ?? "") }; } }
    }
    for await (const chunk of streamProjectArchive(manifest, sources(), { maxBytes: limits.maxBytes ?? 100 * 1024 * 1024, maxEntryBytes: limits.maxEntryBytes ?? 10 * 1024 * 1024, compression: "stored", dataDescriptor: true })) await channel.push(chunk);
  }, { isolationLevel: "repeatable read" });
  void produce().then(() => channel.close()).catch(async (error) => { try { await db.insert(auditEvents).values({ userId, action: "project.export", targetType: "project", targetId: projectId, result: error instanceof ProjectArchiveExportError && error.statusCode === 404 ? "not_found" : error instanceof ProjectArchiveExportError && error.statusCode === 409 ? "conflict" : "error", requestId: `${requestId}:failure`, metadata: { code: error instanceof ProjectArchiveExportError ? error.code : "export_failed" } }); } catch {} channel.fail(error); });
  return channel;
}

function sha256(value: Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }

export class BackpressureChannel implements AsyncIterable<Uint8Array> {
  private pending: { value: Uint8Array; consumed: () => void; reject: (error: unknown) => void } | null = null;
  private waiter: { resolve: (result: IteratorResult<Uint8Array>) => void; reject: (error: unknown) => void } | null = null;
  private ended = false;
  private failure: unknown;
  async push(value: Uint8Array) { if (this.ended) throw new Error("Export stream cancelled"); await new Promise<void>((resolve, reject) => { this.pending = { value, consumed: resolve, reject }; this.flush(); }); }
  close() { this.ended = true; this.flush(); }
  fail(error: unknown) { this.failure = error; this.ended = true; this.pending?.reject(error); this.pending = null; this.flush(); }
  [Symbol.asyncIterator](): AsyncIterator<Uint8Array> { return { next: () => this.next(), return: async () => { this.fail(new Error("Export stream cancelled")); return { done: true, value: undefined }; } }; }
  private next(): Promise<IteratorResult<Uint8Array>> { if (this.failure) return Promise.reject(this.failure); if (this.pending) { const item = this.pending; this.pending = null; item.consumed(); return Promise.resolve({ done: false, value: item.value }); } if (this.ended) return Promise.resolve({ done: true, value: undefined }); return new Promise((resolve, reject) => { this.waiter = { resolve, reject }; this.flush(); }); }
  private flush() { if (!this.waiter) return; if (this.failure) { const waiter = this.waiter; this.waiter = null; waiter.reject(this.failure); return; } if (this.pending) { const waiter = this.waiter, item = this.pending; this.waiter = null; this.pending = null; item.consumed(); waiter.resolve({ done: false, value: item.value }); } else if (this.ended) { const waiter = this.waiter; this.waiter = null; waiter.resolve({ done: true, value: undefined }); } }
}
