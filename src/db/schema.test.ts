import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { createDatabase } from "./client.js";
import { migrateDatabase, migrationsFolder } from "./migrate.js";
import * as schema from "./schema/index.js";
import { createAuthRepository } from "../web/auth/session.js";

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

function foreignKeyShape(table: Parameters<typeof getTableConfig>[0], name: string) {
  const foreignKey = getTableConfig(table).foreignKeys.find((candidate) => candidate.getName() === name);
  const reference = foreignKey?.reference();

  return {
    columns: reference?.columns.map((column) => column.name),
    foreignColumns: reference?.foreignColumns.map((column) => column.name),
    foreignTable: reference ? getTableConfig(reference.foreignTable).name : undefined,
  };
}

function uniqueShape(table: Parameters<typeof getTableConfig>[0], name: string) {
  const constraint = getTableConfig(table).uniqueConstraints.find(
    (candidate) => candidate.getName() === name,
  );
  return constraint?.columns.map((column) => column.name);
}

function indexShape(table: Parameters<typeof getTableConfig>[0], name: string) {
  const index = getTableConfig(table).indexes.find((candidate) => candidate.config.name === name);
  return index?.config.columns.map((column) => "name" in column! ? column.name : undefined);
}

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

  it("defines critical columns and index metadata", () => {
    const users = getTableConfig(schema.users);
    const artifacts = getTableConfig(schema.artifacts);
    const chapters = getTableConfig(schema.chapters);
    const runEvents = getTableConfig(schema.runEvents);
    const tasks = getTableConfig(schema.tasks);

    expect(users.indexes.map((index) => index.config.name)).toContain("users_username_uq");
    expect(users.columns.find((column) => column.name === "auth_version")?.getSQLType()).toBe("integer");
    expect(getTableConfig(schema.sessions).columns.find((column) => column.name === "auth_version")?.getSQLType()).toBe("integer");
    expect(artifacts.columns.find((column) => column.name === "content_json")?.getSQLType()).toBe("jsonb");
    expect(chapters.columns.find((column) => column.name === "body")?.getSQLType()).toBe("text");
    expect(runEvents.columns.find((column) => column.name === "sequence")?.getSQLType()).toBe("integer");
    expect(runEvents.columns.find((column) => column.name === "created_at")?.getSQLType()).toBe(
      "timestamp with time zone",
    );
    expect(runEvents.indexes.map((index) => index.config.name)).toEqual(
      expect.arrayContaining(["run_events_run_sequence_uq", "run_events_user_project_idx"]),
    );
    const activeWriteIndex = tasks.indexes.find(
      (index) => index.config.name === "tasks_active_write_project_uq",
    );
    expect(activeWriteIndex?.config.unique).toBe(true);
    expect(activeWriteIndex?.config.columns.map((column) => "name" in column! && column.name)).toEqual([
      "project_id",
    ]);
    expect(activeWriteIndex?.config.where).toBeDefined();
  });

  it("enforces tenant ownership through composite keys", () => {
    expect(uniqueShape(schema.projects, "projects_user_id_id_uq")).toEqual(["user_id", "id"]);
    expect(uniqueShape(schema.runs, "runs_user_project_id_uq")).toEqual([
      "user_id",
      "project_id",
      "id",
    ]);
    expect(foreignKeyShape(schema.runs, "runs_user_project_fk")).toEqual({
      columns: ["user_id", "project_id"],
      foreignColumns: ["user_id", "id"],
      foreignTable: "projects",
    });
    expect(foreignKeyShape(schema.artifacts, "artifacts_user_project_run_fk")).toEqual({ columns: ["user_id", "project_id", "run_id"], foreignColumns: ["user_id", "project_id", "id"], foreignTable: "runs" });
    expect(foreignKeyShape(schema.chapters, "chapters_user_project_run_fk")).toEqual({ columns: ["user_id", "project_id", "run_id"], foreignColumns: ["user_id", "project_id", "id"], foreignTable: "runs" });
    expect(indexShape(schema.artifacts, "artifacts_scope_type_version_uq")).toEqual(["user_id", "project_id", "run_id", "type", "version"]);
    expect(indexShape(schema.chapters, "chapters_scope_sequence_version_uq")).toEqual(["user_id", "project_id", "run_id", "sequence", "version"]);

    for (const [table, name] of [
      [schema.tasks, "tasks_user_project_run_fk"],
      [schema.runEvents, "run_events_user_project_run_fk"],
      [schema.streamChunks, "stream_chunks_user_project_run_fk"],
      [schema.checkpoints, "checkpoints_user_project_run_fk"],
      [schema.usageRecords, "usage_records_user_project_run_fk"],
    ] as const) {
      expect(foreignKeyShape(table, name)).toEqual({
        columns: ["user_id", "project_id", "run_id"],
        foreignColumns: ["user_id", "project_id", "id"],
        foreignTable: "runs",
      });
    }
  });

  it("constrains latest checkpoints and quota ledger scope", () => {
    expect(uniqueShape(schema.checkpoints, "checkpoints_user_project_run_id_uq")).toEqual([
      "user_id",
      "project_id",
      "run_id",
      "id",
    ]);
    expect(foreignKeyShape(schema.runs, "runs_latest_checkpoint_fk")).toEqual({
      columns: ["user_id", "project_id", "id", "latest_checkpoint_id"],
      foreignColumns: ["user_id", "project_id", "run_id", "id"],
      foreignTable: "checkpoints",
    });
    expect(foreignKeyShape(schema.quotaLedger, "quota_ledger_user_project_fk")).toEqual({
      columns: ["user_id", "project_id"],
      foreignColumns: ["user_id", "id"],
      foreignTable: "projects",
    });
    expect(foreignKeyShape(schema.quotaLedger, "quota_ledger_user_project_run_fk")).toEqual({
      columns: ["user_id", "project_id", "run_id"],
      foreignColumns: ["user_id", "project_id", "id"],
      foreignTable: "runs",
    });
    expect(getTableConfig(schema.quotaLedger).checks.map((check) => check.name)).toContain(
      "quota_ledger_run_requires_project_ck",
    );
  });

  it("resolves migrations relative to the database module", () => {
    expect(migrationsFolder).toBe(fileURLToPath(new URL("../../drizzle", import.meta.url)));
  });

  it("contains all required migration constraints", async () => {
    const foundationSql = await readFile(
      new URL("../../drizzle/0000_platform_foundation.sql", import.meta.url),
      "utf8",
    );
    const ownershipSql = await readFile(
      new URL("../../drizzle/0001_tenant_ownership.sql", import.meta.url),
      "utf8",
    );
    const authenticationSql = await readFile(
      new URL("../../drizzle/0002_lean_felicia_hardy.sql", import.meta.url),
      "utf8",
    );
    const storeScopeSql = await readFile(new URL("../../drizzle/0003_lonely_shiva.sql", import.meta.url), "utf8");
    const sql = `${foundationSql}\n${ownershipSql}\n${authenticationSql}\n${storeScopeSql}`;

    for (const table of requiredTables) {
      expect(sql).toContain(`CREATE TABLE \"${table}\"`);
    }
    expect(sql).toContain('CREATE UNIQUE INDEX "users_username_uq"');
    expect(authenticationSql).toContain('ALTER TABLE "users" ADD COLUMN "auth_version" integer DEFAULT 1 NOT NULL');
    expect(authenticationSql).toContain('ALTER TABLE "sessions" ADD COLUMN "auth_version" integer DEFAULT 1 NOT NULL');
    expect(storeScopeSql).toContain('ALTER TABLE "artifacts" ALTER COLUMN "run_id" SET NOT NULL');
    expect(storeScopeSql).toContain('ALTER TABLE "chapters" ALTER COLUMN "run_id" SET NOT NULL');
    expect(storeScopeSql).toContain('CONSTRAINT "artifacts_user_project_run_fk"');
    expect(storeScopeSql).toContain('CONSTRAINT "chapters_user_project_run_fk"');
    expect(sql).toContain('CREATE UNIQUE INDEX "run_events_run_sequence_uq"');
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "tasks_active_write_project_uq"[\s\S]+WHERE .*"type" = 'write'.*"status" in \('leased', 'running'\)/i,
    );
    expect(sql).toContain('CONSTRAINT "runs_user_project_fk" FOREIGN KEY ("user_id","project_id")');
    expect(sql).toContain(
      'CONSTRAINT "runs_latest_checkpoint_fk" FOREIGN KEY ("user_id","project_id","id","latest_checkpoint_id")',
    );
    expect(sql).toContain(
      'CONSTRAINT "quota_ledger_user_project_run_fk" FOREIGN KEY ("user_id","project_id","run_id")',
    );
    expect(sql.indexOf('CONSTRAINT "projects_user_id_id_uq" UNIQUE')).toBeLessThan(
      sql.indexOf('CONSTRAINT "runs_user_project_fk" FOREIGN KEY'),
    );
    expect(sql.indexOf('CONSTRAINT "runs_user_project_id_uq" UNIQUE')).toBeLessThan(
      sql.indexOf('CONSTRAINT "tasks_user_project_run_fk" FOREIGN KEY'),
    );
    expect(sql.indexOf('CONSTRAINT "checkpoints_user_project_run_id_uq" UNIQUE')).toBeLessThan(
      sql.indexOf('CONSTRAINT "runs_latest_checkpoint_fk" FOREIGN KEY'),
    );
    expect(sql).toContain(
      'UPDATE "quota_ledger" SET "project_id" = "runs"."project_id" FROM "runs" WHERE "quota_ledger"."run_id" = "runs"."id"',
    );
    expect(sql.indexOf('UPDATE "quota_ledger" SET "project_id"')).toBeLessThan(
      sql.indexOf('CONSTRAINT "quota_ledger_user_project_run_fk" FOREIGN KEY'),
    );
  });
});

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;

integration("PostgreSQL migration", () => {
  const databaseUrl = testDatabaseUrl!;

  it("enforces uniqueness, ownership, active writes, enums, and defaults", async () => {
    await migrateDatabase(databaseUrl);
    const database = createDatabase(databaseUrl);

    try {
      const suffix = crypto.randomUUID();
      const [user, otherUser] = await database
        .insert(schema.users)
        .values([
          { username: `writer-${suffix}`, passwordHash: "test" },
          { username: `other-${suffix}`, passwordHash: "test" },
        ])
        .returning();
      expect(user).toMatchObject({ role: "user", status: "active", concurrencyLimit: 1, authVersion: 1 });
      const [session] = await database
        .insert(schema.sessions)
        .values({ userId: user!.id, tokenDigest: crypto.randomUUID(), expiresAt: new Date(Date.now() + 60_000) })
        .returning();
      expect(session).toMatchObject({ authVersion: 1 });
      await expect(
        database.insert(schema.users).values({ username: user!.username, passwordHash: "test" }),
      ).rejects.toThrow();
      await expect(
        database.insert(schema.users).values({
          username: `invalid-${suffix}`,
          passwordHash: "test",
          status: "unknown" as "active",
        }),
      ).rejects.toThrow();

      const [project, otherProject] = await database
        .insert(schema.projects)
        .values([
          { userId: user!.id, title: "Test project" },
          { userId: otherUser!.id, title: "Other project" },
        ])
        .returning();
      const [run, otherRun] = await database
        .insert(schema.runs)
        .values([
          { userId: user!.id, projectId: project!.id },
          { userId: otherUser!.id, projectId: otherProject!.id },
        ])
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
      await expect(
        database.insert(schema.runEvents).values({ ...event, userId: otherUser!.id, sequence: 2 }),
      ).rejects.toThrow();

      await database.insert(schema.tasks).values({
        userId: user!.id,
        projectId: project!.id,
        runId: run!.id,
        type: "write",
        status: "leased",
      });
      await expect(
        database.insert(schema.tasks).values({
          userId: user!.id,
          projectId: project!.id,
          runId: run!.id,
          type: "write",
          status: "running",
        }),
      ).rejects.toThrow();
      await database.insert(schema.tasks).values([
        {
          userId: user!.id,
          projectId: project!.id,
          runId: run!.id,
          type: "write",
          status: "queued",
        },
        {
          userId: user!.id,
          projectId: project!.id,
          runId: run!.id,
          type: "review",
          status: "running",
        },
      ]);

      const [checkpoint] = await database
        .insert(schema.checkpoints)
        .values({
          userId: user!.id,
          projectId: project!.id,
          runId: run!.id,
          version: 1,
          state: {},
          taskFingerprint: "test",
          projectVersion: 1,
        })
        .returning();
      await database.update(schema.runs).set({ latestCheckpointId: checkpoint!.id }).where(
        eq(schema.runs.id, run!.id),
      );
      await expect(
        database.update(schema.runs).set({ latestCheckpointId: checkpoint!.id }).where(
          eq(schema.runs.id, otherRun!.id),
        ),
      ).rejects.toThrow();

      await database.insert(schema.quotaLedger).values([
        { userId: user!.id, source: "grant", amount: "10", balance: "10" },
        {
          userId: user!.id,
          projectId: project!.id,
          source: "project",
          amount: "1",
          balance: "9",
        },
        {
          userId: user!.id,
          projectId: project!.id,
          runId: run!.id,
          source: "run",
          amount: "-1",
          balance: "8",
        },
      ]);
      await expect(
        database.insert(schema.quotaLedger).values({
          userId: otherUser!.id,
          projectId: project!.id,
          runId: run!.id,
          source: "invalid",
          amount: "-1",
          balance: "0",
        }),
      ).rejects.toThrow();
      await expect(
        database.insert(schema.quotaLedger).values({
          userId: user!.id,
          runId: run!.id,
          source: "invalid",
          amount: "-1",
          balance: "0",
        }),
      ).rejects.toThrow();
    } finally {
      await database.$client.end();
    }
  });

  it("atomically binds sessions to the current authentication version", async () => {
    await migrateDatabase(databaseUrl);
    const database = createDatabase(databaseUrl);

    try {
      const suffix = crypto.randomUUID();
      const [user] = await database
        .insert(schema.users)
        .values({ username: `auth-${suffix}`, passwordHash: "current-hash" })
        .returning();
      const repository = createAuthRepository(database);
      const stale = await repository.createSessionIfCurrent({
        userId: user!.id,
        passwordHash: "stale-hash",
        authVersion: user!.authVersion,
        tokenDigest: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 60_000),
      });
      expect(stale).toBeUndefined();

      const created = await repository.createSessionIfCurrent({
        userId: user!.id,
        passwordHash: user!.passwordHash,
        authVersion: user!.authVersion,
        tokenDigest: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 60_000),
      });
      expect(created).toBeDefined();

      const changed = await repository.updatePasswordAndRevokeSessions(
        user!.id,
        "new-hash",
        user!.passwordHash,
        user!.authVersion,
        new Date(),
      );
      expect(changed).toBe(true);
      expect(
        await repository.updatePasswordAndRevokeSessions(
          user!.id,
          "stale-overwrite",
          user!.passwordHash,
          user!.authVersion,
          new Date(),
        ),
      ).toBe(false);
      const [updatedUser] = await database.select().from(schema.users).where(eq(schema.users.id, user!.id));
      const [session] = await database.select().from(schema.sessions).where(eq(schema.sessions.id, created!.id));
      expect(updatedUser).toMatchObject({ passwordHash: "new-hash", authVersion: 2 });
      expect(session?.revokedAt).toBeInstanceOf(Date);
    } finally {
      await database.$client.end();
    }
  });
});
