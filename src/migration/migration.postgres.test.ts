import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../db/client.js";
import { migrateDatabase } from "../db/migrate.js";
import { auditEvents, chapters, checkpoints, projects, runs, users } from "../db/schema/index.js";
import { parseProjectArchive } from "./archive.js";
import { exportDatabaseProject, importProjectArchive } from "./fileProjectImporter.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const postgres = databaseUrl ? describe : describe.skip;

postgres("PostgreSQL project archive migration", () => {
  let db: Database;
  let ownerId: string;
  let otherId: string;

  beforeAll(async () => {
    await migrateDatabase(databaseUrl!);
    db = createDatabase(databaseUrl!);
    const rows = await db.insert(users).values([
      { username: `archive-owner-${randomUUID()}`, passwordHash: "test" },
      { username: `archive-other-${randomUUID()}`, passwordHash: "test" },
    ]).returning();
    ownerId = rows[0]!.id; otherId = rows[1]!.id;
  });
  afterAll(async () => db.$client.end());

  it("exports the latest checkpoint-complete run, isolates tenants and round-trips into a new tenant", async () => {
    const [project] = await db.insert(projects).values({ userId: ownerId, title: "Stable", version: 4 }).returning();
    const [stable] = await db.insert(runs).values({ userId: ownerId, projectId: project!.id, status: "completed", completedAt: new Date("2026-07-15T00:00:00Z") }).returning();
    const [checkpoint] = await db.insert(checkpoints).values({ userId: ownerId, projectId: project!.id, runId: stable!.id, version: 2, state: {}, taskFingerprint: "stable", projectVersion: 4 }).returning();
    await db.update(runs).set({ latestCheckpointId: checkpoint!.id }).where(eq(runs.id, stable!.id));
    await db.insert(chapters).values({ userId: ownerId, projectId: project!.id, runId: stable!.id, sequence: 1, title: "Stable", body: "stable body", status: "complete", version: 2 });
    await db.insert(runs).values({ userId: ownerId, projectId: project!.id, status: "running" });

    const archive = await collect(exportDatabaseProject(db, ownerId, project!.id, 4));
    const parsed = await parseProjectArchive(archive);
    expect(parsed.manifest.run.id).toBe(stable!.id);
    expect(parsed.manifest.checkpoint.id).toBe(checkpoint!.id);
    expect(parsed.files.get("chapters/1.md")?.toString()).toBe("stable body");
    await expect(collect(exportDatabaseProject(db, otherId, project!.id, 4))).rejects.toMatchObject({ statusCode: 404 });

    const imported = await importProjectArchive(db, otherId, archive);
    const [copy] = await db.select().from(projects).where(eq(projects.id, imported.projectId));
    expect(copy).toMatchObject({ userId: otherId, title: "Stable", version: 4 });
  });

  it("rolls back an import when its success audit cannot commit", async () => {
    const [project] = await db.select().from(projects).where(eq(projects.userId, ownerId)).limit(1);
    const archive = await collect(exportDatabaseProject(db, ownerId, project!.id, project!.version));
    const requestId = randomUUID();
    await db.insert(auditEvents).values({ userId: otherId, action: "project.import", targetType: "project", result: "reserved", requestId });
    await expect(importProjectArchive(db, otherId, archive, requestId)).rejects.toThrow();
    const copies = await db.select().from(projects).where(eq(projects.userId, otherId));
    expect(copies.filter((row) => row.title === project!.title)).toHaveLength(1);
  });
});

async function collect(source: AsyncIterable<Uint8Array>): Promise<Buffer> { const chunks: Buffer[] = []; for await (const chunk of source) chunks.push(Buffer.from(chunk)); return Buffer.concat(chunks); }
