import { sql } from "drizzle-orm";
import { type AnyPgColumn, bigint, check, foreignKey, index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { projects } from "./projects.js";

export const runStatus = pgEnum("run_status", ["queued", "running", "paused", "completed", "failed", "cancelled"]);
export const taskType = pgEnum("task_type", ["write", "review", "maintenance"]);
export const taskStatus = pgEnum("task_status", ["queued", "leased", "running", "paused", "completed", "failed", "cancelled"]);
export const artifactStatus = pgEnum("artifact_status", ["draft", "committed"]);
export const chapterStatus = pgEnum("chapter_status", ["planned", "draft", "review", "complete"]);
export const runCommandStatus = pgEnum("run_command_status", ["pending", "claimed", "applied"]);

type RunOwnershipColumns = [
  AnyPgColumn<{ tableName: "runs" }>,
  AnyPgColumn<{ tableName: "runs" }>,
  AnyPgColumn<{ tableName: "runs" }>,
];

type CheckpointOwnershipColumns = [
  AnyPgColumn<{ tableName: "checkpoints" }>,
  AnyPgColumn<{ tableName: "checkpoints" }>,
  AnyPgColumn<{ tableName: "checkpoints" }>,
  AnyPgColumn<{ tableName: "checkpoints" }>,
];

function runOwnershipColumns(): RunOwnershipColumns {
  return [runs.userId, runs.projectId, runs.id];
}

function checkpointOwnershipColumns(): CheckpointOwnershipColumns {
  return [checkpoints.userId, checkpoints.projectId, checkpoints.runId, checkpoints.id];
}

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull(),
    idempotencyKey: text("idempotency_key"),
    status: runStatus("status").notNull().default("queued"),
    latestCheckpointId: uuid("latest_checkpoint_id"),
    budgetSnapshot: jsonb("budget_snapshot").notNull().default({}),
    resumeData: jsonb("resume_data"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "runs_user_project_fk",
      columns: [table.userId, table.projectId],
      foreignColumns: [projects.userId, projects.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "runs_latest_checkpoint_fk",
      columns: [table.userId, table.projectId, table.id, table.latestCheckpointId],
      foreignColumns: checkpointOwnershipColumns(),
    }),
    unique("runs_user_project_id_uq").on(table.userId, table.projectId, table.id),
    uniqueIndex("runs_start_idempotency_uq").on(table.userId, table.projectId, table.idempotencyKey),
    index("runs_user_project_status_idx").on(table.userId, table.projectId, table.status),
  ],
);

export const artifacts = pgTable(
  "artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(), userId: uuid("user_id").notNull(), projectId: uuid("project_id").notNull(), runId: uuid("run_id").notNull(), type: text("type").notNull(), contentJson: jsonb("content_json"), contentText: text("content_text"), status: artifactStatus("status").notNull().default("draft"), version: integer("version").notNull().default(1), summary: text("summary"), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ name: "artifacts_user_project_run_fk", columns: [table.userId, table.projectId, table.runId], foreignColumns: runOwnershipColumns() }).onDelete("cascade"),
    uniqueIndex("artifacts_scope_type_version_uq").on(table.userId, table.projectId, table.runId, table.type, table.version),
    index("artifacts_scope_idx").on(table.userId, table.projectId, table.runId),
  ],
);

export const chapters = pgTable(
  "chapters",
  {
    id: uuid("id").primaryKey().defaultRandom(), userId: uuid("user_id").notNull(), projectId: uuid("project_id").notNull(), runId: uuid("run_id").notNull(), sequence: integer("sequence").notNull(), title: text("title").notNull(), body: text("body").notNull().default(""), status: chapterStatus("status").notNull().default("planned"), version: integer("version").notNull().default(1), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ name: "chapters_user_project_run_fk", columns: [table.userId, table.projectId, table.runId], foreignColumns: runOwnershipColumns() }).onDelete("cascade"),
    uniqueIndex("chapters_scope_sequence_version_uq").on(table.userId, table.projectId, table.runId, table.sequence, table.version),
    index("chapters_scope_idx").on(table.userId, table.projectId, table.runId),
    check("chapters_sequence_positive_ck", sql`${table.sequence} > 0`),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    projectId: uuid("project_id").notNull(),
    runId: uuid("run_id").notNull(),
    type: taskType("type").notNull(),
    status: taskStatus("status").notNull().default("queued"),
    priority: integer("priority").notNull().default(0),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    leaseVersion: integer("lease_version").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull().defaultNow(),
    payload: jsonb("payload").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "tasks_user_project_run_fk",
      columns: [table.userId, table.projectId, table.runId],
      foreignColumns: runOwnershipColumns(),
    }).onDelete("cascade"),
    index("tasks_status_lease_schedule_idx").on(table.status, table.leaseExpiresAt, table.scheduledAt),
    index("tasks_user_status_idx").on(table.userId, table.status),
    uniqueIndex("tasks_active_write_project_uq")
      .on(table.projectId)
      .where(sql`${table.type} = 'write' and ${table.status} in ('leased', 'running')`),
  ],
);

export const runEvents = pgTable(
  "run_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    projectId: uuid("project_id").notNull(),
    runId: uuid("run_id").notNull(),
    sequence: integer("sequence").notNull(),
    stableId: text("stable_id"),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "run_events_user_project_run_fk",
      columns: [table.userId, table.projectId, table.runId],
      foreignColumns: runOwnershipColumns(),
    }).onDelete("cascade"),
    uniqueIndex("run_events_run_sequence_uq").on(table.runId, table.sequence),
    uniqueIndex("run_events_run_stable_id_uq").on(table.runId, table.stableId),
    index("run_events_user_project_idx").on(table.userId, table.projectId),
  ],
);

export const streamChunks = pgTable(
  "stream_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    projectId: uuid("project_id").notNull(),
    runId: uuid("run_id").notNull(),
    sequence: integer("sequence").notNull(),
    agent: text("agent").notNull(),
    text: text("text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "stream_chunks_user_project_run_fk",
      columns: [table.userId, table.projectId, table.runId],
      foreignColumns: runOwnershipColumns(),
    }).onDelete("cascade"),
    uniqueIndex("stream_chunks_run_sequence_uq").on(table.runId, table.sequence),
    index("stream_chunks_user_project_idx").on(table.userId, table.projectId),
  ],
);

export const checkpoints = pgTable(
  "checkpoints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    projectId: uuid("project_id").notNull(),
    runId: uuid("run_id").notNull(),
    version: integer("version").notNull(),
    state: jsonb("state").notNull(),
    summary: text("summary"),
    taskFingerprint: text("task_fingerprint").notNull(),
    projectVersion: integer("project_version").notNull(),
    committedAt: timestamp("committed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "checkpoints_user_project_run_fk",
      columns: [table.userId, table.projectId, table.runId],
      foreignColumns: runOwnershipColumns(),
    }).onDelete("cascade"),
    unique("checkpoints_user_project_run_id_uq").on(
      table.userId,
      table.projectId,
      table.runId,
      table.id,
    ),
    uniqueIndex("checkpoints_run_version_uq").on(table.runId, table.version),
    index("checkpoints_user_project_idx").on(table.userId, table.projectId),
  ],
);

export const usageRecords = pgTable(
  "usage_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    projectId: uuid("project_id").notNull(),
    runId: uuid("run_id").notNull(),
    snapshotId: text("snapshot_id").notNull(),
    agent: text("agent").notNull(),
    credentialSource: text("credential_source").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
    outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
    cost: numeric("cost", { precision: 18, scale: 8 }).notNull().default("0"),
    latencyMs: integer("latency_ms").notNull(),
    state: jsonb("state"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "usage_records_user_project_run_fk",
      columns: [table.userId, table.projectId, table.runId],
      foreignColumns: runOwnershipColumns(),
    }).onDelete("cascade"),
    index("usage_records_user_created_idx").on(table.userId, table.createdAt),
    uniqueIndex("usage_records_run_snapshot_uq").on(table.runId, table.snapshotId),
  ],
);

export const runCommands = pgTable(
  "run_commands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    projectId: uuid("project_id").notNull(),
    runId: uuid("run_id").notNull(),
    commandId: text("command_id").notNull(),
    instruction: text("instruction").notNull(),
    status: runCommandStatus("status").notNull().default("pending"),
    claimedBy: text("claimed_by"),
    claimedLeaseVersion: integer("claimed_lease_version"),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ name: "run_commands_user_project_run_fk", columns: [table.userId, table.projectId, table.runId], foreignColumns: runOwnershipColumns() }).onDelete("cascade"),
    uniqueIndex("run_commands_run_command_uq").on(table.runId, table.commandId),
    index("run_commands_run_status_idx").on(table.runId, table.status),
  ],
);
