import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { and, asc, desc, eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { artifacts, auditEvents, chapters, projects, runs } from "../db/schema/index.js";
import { createProjectArchive, parseProjectArchive, type ArchiveSource, type ProjectArchiveManifest } from "./archive.js";

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
  return createProjectArchive({ format: "synchronicle-project", version: 1, project: { title, version: 1 }, exportedAt: new Date().toISOString(), chapters: chapterIndex, artifacts: [] }, files);
}

export async function importFileProject(db: Database, userId: string, projectDir: string, requestId: string = randomUUID()) {
  return importProjectArchive(db, userId, await archiveFileProject(projectDir), requestId);
}

export async function importProjectArchive(db: Database, userId: string, source: ArchiveSource, requestId: string = randomUUID()) {
  const parsed = await parseProjectArchive(source);
  return db.transaction(async (tx) => {
    const [project] = await tx.insert(projects).values({ userId, title: parsed.manifest.project.title, version: parsed.manifest.project.version }).returning();
    if (!project) throw new Error("Project insert returned no row");
    const [run] = await tx.insert(runs).values({ userId, projectId: project.id, status: "completed", startedAt: new Date(parsed.manifest.exportedAt), completedAt: new Date(parsed.manifest.exportedAt) }).returning();
    if (!run) throw new Error("Run insert returned no row");
    if (parsed.manifest.chapters.length) await tx.insert(chapters).values(parsed.manifest.chapters.map((entry) => ({ userId, projectId: project.id, runId: run.id, sequence: entry.sequence, title: entry.title, body: parsed.files.get(entry.path)!.toString("utf8"), status: entry.status, version: entry.version })));
    if (parsed.manifest.artifacts.length) await tx.insert(artifacts).values(parsed.manifest.artifacts.map((entry) => { const content = parsed.files.get(entry.path)!.toString("utf8"); return { userId, projectId: project.id, runId: run.id, type: entry.type, status: entry.status, version: entry.version, ...(entry.encoding === "json" ? { contentJson: JSON.parse(content) } : { contentText: content }) }; }));
    await tx.insert(auditEvents).values({ userId, action: "project.import", targetType: "project", targetId: project.id, result: "success", requestId, metadata: { formatVersion: parsed.manifest.version, chapters: parsed.manifest.chapters.length, artifacts: parsed.manifest.artifacts.length } });
    return { projectId: project.id, runId: run.id, project };
  });
}

export async function exportDatabaseProject(db: Database, userId: string, projectId: string, requestId: string = randomUUID()): Promise<Buffer | null> {
  return db.transaction(async (tx) => {
    const [project] = await tx.select().from(projects).where(and(eq(projects.userId, userId), eq(projects.id, projectId))).limit(1);
    if (!project) return null;
    const [run] = await tx.select().from(runs).where(and(eq(runs.userId, userId), eq(runs.projectId, projectId))).orderBy(desc(runs.updatedAt), desc(runs.createdAt)).limit(1);
    const files = new Map<string, Buffer>();
    const chapterIndex: ProjectArchiveManifest["chapters"] = [];
    const artifactIndex: ProjectArchiveManifest["artifacts"] = [];
    if (run) {
      const chapterRows = await tx.select().from(chapters).where(and(eq(chapters.userId, userId), eq(chapters.projectId, projectId), eq(chapters.runId, run.id))).orderBy(asc(chapters.sequence), desc(chapters.version));
      const seenChapters = new Set<number>();
      for (const row of chapterRows) {
        if (seenChapters.has(row.sequence)) continue;
        seenChapters.add(row.sequence);
        const path = `chapters/${row.sequence}.md`, body = Buffer.from(row.body);
        files.set(path, body);
        chapterIndex.push({ sequence: row.sequence, title: row.title, status: row.status, version: row.version, path, checksum: sha256(body) });
      }
      const artifactRows = await tx.select().from(artifacts).where(and(eq(artifacts.userId, userId), eq(artifacts.projectId, projectId), eq(artifacts.runId, run.id))).orderBy(asc(artifacts.type), desc(artifacts.version));
      const seenArtifacts = new Set<string>();
      for (const row of artifactRows) {
        if (seenArtifacts.has(row.type)) continue;
        seenArtifacts.add(row.type);
        const encoding = row.contentJson === null ? "text" as const : "json" as const;
        const body = Buffer.from(encoding === "json" ? JSON.stringify(row.contentJson) : row.contentText ?? "");
        const path = `artifacts/${safeSegment(row.type)}.${encoding === "json" ? "json" : "txt"}`;
        files.set(path, body);
        artifactIndex.push({ type: row.type, status: row.status, version: row.version, encoding, path, checksum: sha256(body) });
      }
    }
    const archive = createProjectArchive({ format: "synchronicle-project", version: 1, project: { title: project.title, version: project.version }, exportedAt: new Date().toISOString(), chapters: chapterIndex, artifacts: artifactIndex }, files);
    await tx.insert(auditEvents).values({ userId, action: "project.export", targetType: "project", targetId: project.id, result: "success", requestId, metadata: { formatVersion: 1, chapters: chapterIndex.length, artifacts: artifactIndex.length } });
    return archive;
  }, { isolationLevel: "repeatable read" });
}

function sha256(value: Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
function safeSegment(value: string): string { return value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^\.+/, "") || "artifact"; }
