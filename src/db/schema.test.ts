import { readFile } from "node:fs/promises";
import { getTableConfig } from "drizzle-orm/pg-core";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabase } from "./client.js";
import { migrateDatabase } from "./migrate.js";
import * as schema from "./schema/index.js";

const requiredTables = [
  "users",
  "sessions",
  "projects",
  "artifacts",
  "chapters",
  "runs",
  "tasks",
  "run_events",
  "stream_chunks",
  "checkpoints",
  "usage_records",
  "provider_credentials",
  "platform_models",
  "quota_ledger",
  "audit_events",
] as const;

describe("database schema", () => {
  it("defines every platform table", () => {
    const tables = [
      schema.users,
      schema.sessions,
      schema.projects,
      schema.artifacts,
      schema.chapters,
      schema.runs,
      schema.tasks,
      schema.runEvents,
      schema.streamChunks,
      schema.checkpoints,
      schema.usageRecords,
      schema.providerCredentials,
      schema.platformModels,
      schema.quotaLedger,
      schema.auditEvents,
    ];
    const tableNames = tables.map((table) => getTableConfig(table).name);

    expect(tableNames).toEqual(expect.arrayContaining([...requiredTables]));
  });

  it("defines critical columns, foreign keys, and indexes", () => {
    const users = getTableConfig(schema.users);
    const artifacts = getTableConfig(schema.artifacts);
    const chapters = getTableConfig(schema.chapters);
    const runEvents = getTableConfig(schema.runEvents);
    const tasks = getTableConfig(schema.tasks);

    expect(users.indexes.map((index) => index.config.name)).toContain("users_username_uq");
    expect(artifacts.columns.find((column) => column.name === "content_json")?.getSQLType()).toBe("jsonb");
    expect(chapters.columns.find((column) => column.name === "body")?.getSQLType()).toBe("text");
    expect(runEvents.columns.find((column) => column.name === "sequence")?.getSQLType()).toBe("integer");
    expect(runEvents.columns.find((column) => column.name === "created_at")?.getSQLType()).toBe(
      "timestamp with time zone",
    );
    expect(runEvents.foreignKeys).toHaveLength(3);
    expect(runEvents.indexes.map((index) => index.config.name)).toEqual(
      expect.arrayContaining(["run_events_run_sequence_uq", "run_events_user_project_idx"]),
    );
    expect(tasks.indexes.map((index) => index.config.name)).toContain("tasks_active_write_project_uq");
  });

  it("contains all required migration constraints", async () => {
    const sql = await readFile(new URL("../../drizzle/0000_platform_foundation.sql", import.meta.url), "utf8");

    for (const table of requiredTables) {
      expect(sql).toContain(`CREATE TABLE \"${table}\"`);
    }
    expect(sql).toContain('CREATE UNIQUE INDEX "users_username_uq"');
    expect(sql).toContain('CREATE UNIQUE INDEX "run_events_run_sequence_uq"');
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "tasks_active_write_project_uq"[\s\S]+WHERE .*"type" = 'write'.*"status" in \('leased', 'running'\)/i,
    );
  });
});

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;

integration("PostgreSQL migration", () => {
  const databaseUrl = testDatabaseUrl!;
  const database = createDatabase(databaseUrl);

  afterAll(async () => {
    await database.$client.end();
  });

  it("enforces unique usernames and run event sequences", async () => {
    await migrateDatabase(databaseUrl);

    const [user] = await database
      .insert(schema.users)
      .values({ username: `writer-${crypto.randomUUID()}`, passwordHash: "test" })
      .returning();
    await expect(
      database.insert(schema.users).values({ username: user!.username, passwordHash: "test" }),
    ).rejects.toThrow();

    const [project] = await database
      .insert(schema.projects)
      .values({ userId: user!.id, title: "Test project" })
      .returning();
    const [run] = await database
      .insert(schema.runs)
      .values({ userId: user!.id, projectId: project!.id })
      .returning();
    const event = {
      userId: user!.id,
      projectId: project!.id,
      runId: run!.id,
      sequence: 1,
      type: "started",
      payload: {},
    };
    await database.insert(schema.runEvents).values(event);
    await expect(database.insert(schema.runEvents).values(event)).rejects.toThrow();
  });
});
