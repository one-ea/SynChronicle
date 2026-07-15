import { sql } from "drizzle-orm";
import { bigint, index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { projects } from "./projects.js";

export const runStatus = pgEnum("run_status", ["queued", "running", "paused", "completed", "failed", "cancelled"]);
export const taskType = pgEnum("task_type", ["write", "review", "maintenance"]);
export const taskStatus = pgEnum("task_status", ["queued", "leased", "running", "paused", "completed", "failed", "cancelled"]);

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    status: runStatus("status").notNull().default("queued"),
    latestCheckpointId: uuid("latest_checkpoint_id"),
    budgetSnapshot: jsonb("budget_snapshot").notNull().default({}),
    resumeData: jsonb("resume_data"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("runs_user_project_status_idx").on(table.userId, table.projectId, table.status)],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
    type: taskType("type").notNull(),
    status: taskStatus("status").notNull().default("queued"),
    priority: integer("priority").notNull().default(0),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull().defaultNow(),
    payload: jsonb("payload").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
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
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("run_events_run_sequence_uq").on(table.runId, table.sequence),
    index("run_events_user_project_idx").on(table.userId, table.projectId),
  ],
);

export const streamChunks = pgTable(
  "stream_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    agent: text("agent").notNull(),
    text: text("text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("stream_chunks_run_sequence_uq").on(table.runId, table.sequence),
    index("stream_chunks_user_project_idx").on(table.userId, table.projectId),
  ],
);

export const checkpoints = pgTable(
  "checkpoints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    state: jsonb("state").notNull(),
    summary: text("summary"),
    taskFingerprint: text("task_fingerprint").notNull(),
    projectVersion: integer("project_version").notNull(),
    committedAt: timestamp("committed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("checkpoints_run_version_uq").on(table.runId, table.version),
    index("checkpoints_user_project_idx").on(table.userId, table.projectId),
  ],
);

export const usageRecords = pgTable(
  "usage_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
    agent: text("agent").notNull(),
    credentialSource: text("credential_source").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
    outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
    cost: numeric("cost", { precision: 18, scale: 8 }).notNull().default("0"),
    latencyMs: integer("latency_ms").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("usage_records_user_created_idx").on(table.userId, table.createdAt)],
);
