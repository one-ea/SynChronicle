import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { projects } from "./projects.js";
import { runs, tasks } from "./runtime.js";

export const credentialStatus = pgEnum("credential_status", ["active", "disabled", "revoked", "invalid"]);
export const modelStatus = pgEnum("model_status", ["active", "disabled"]);
export const quotaOperation = pgEnum("quota_operation", ["credit", "reserve", "settle", "estimate_settle", "release"]);
export const quotaReservationStatus = pgEnum("quota_reservation_status", ["reserved", "provider_started", "provider_completed", "needs_reconciliation", "settled", "released"]);
export const quotaOutboxAction = pgEnum("quota_outbox_action", ["settle", "release"]);
export const quotaOutboxStatus = pgEnum("quota_outbox_status", ["pending", "processed"]);

export const userModelSets = pgTable(
  "user_model_sets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    modelSetId: uuid("model_set_id").notNull().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    version: integer("version").notNull(),
    agents: jsonb("agents").notNull(),
    active: integer("active").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("user_model_sets_user_set_version_uq").on(table.userId, table.modelSetId, table.version),
    index("user_model_sets_user_active_idx").on(table.userId, table.active),
    uniqueIndex("user_model_sets_user_active_uq").on(table.userId).where(sql`${table.active} = 1`),
  ],
);

export const providerCredentials = pgTable(
  "provider_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    label: text("label").notNull().default("Provider credential"),
    ciphertext: text("ciphertext").notNull(),
    encryptedDataKey: text("encrypted_data_key").notNull(),
    algorithmVersion: integer("algorithm_version").notNull(),
    keyVersion: text("key_version").notNull(),
    status: credentialStatus("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("provider_credentials_user_provider_idx").on(table.userId, table.provider),
    index("provider_credentials_user_status_idx").on(table.userId, table.status),
  ],
);

export const platformModels = pgTable(
  "platform_models",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    status: modelStatus("status").notNull().default("active"),
    inputPrice: numeric("input_price", { precision: 18, scale: 8 }).notNull().default("0"),
    outputPrice: numeric("output_price", { precision: 18, scale: 8 }).notNull().default("0"),
    credentialReference: text("credential_reference").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("platform_models_provider_model_uq").on(table.provider, table.model)],
);

export const platformSettings = pgTable("platform_settings", {
  id: integer("id").primaryKey().default(1),
  concurrencyLimit: integer("concurrency_limit").notNull().default(4),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const quotaLedger = pgTable(
  "quota_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id"),
    runId: uuid("run_id"),
    modelCallId: text("model_call_id"),
    operation: quotaOperation("operation").notNull().default("credit"),
    idempotencyKey: text("idempotency_key").notNull().default(sql`gen_random_uuid()::text`),
    reservationId: uuid("reservation_id"),
    source: text("source").notNull(),
    amount: numeric("amount", { precision: 18, scale: 8 }).notNull(),
    balance: numeric("balance", { precision: 18, scale: 8 }).notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "quota_ledger_user_project_fk",
      columns: [table.userId, table.projectId],
      foreignColumns: [projects.userId, projects.id],
    }),
    foreignKey({
      name: "quota_ledger_user_project_run_fk",
      columns: [table.userId, table.projectId, table.runId],
      foreignColumns: [runs.userId, runs.projectId, runs.id],
    }),
    check("quota_ledger_run_requires_project_ck", sql`${table.runId} is null or ${table.projectId} is not null`),
    index("quota_ledger_user_created_idx").on(table.userId, table.createdAt),
    uniqueIndex("quota_ledger_idempotency_uq").on(table.idempotencyKey),
    index("quota_ledger_reservation_idx").on(table.reservationId),
  ],
);

export const modelCallContexts = pgTable("model_call_contexts", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
  scope: text("scope").notNull(),
  invocationKey: text("invocation_key").notNull(),
  sequence: integer("sequence").notNull(),
  leaseVersion: integer("lease_version").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("model_call_contexts_task_lease_scope_sequence_uq").on(table.taskId, table.leaseVersion, table.scope, table.sequence), uniqueIndex("model_call_contexts_task_lease_invocation_uq").on(table.taskId, table.leaseVersion, table.invocationKey)]);

export const quotaReservations = pgTable("quota_reservations", {
  id: uuid("id").primaryKey().references(() => quotaLedger.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
  modelCallId: uuid("model_call_id").notNull().references(() => modelCallContexts.id, { onDelete: "cascade" }),
  taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  leaseVersion: integer("lease_version").notNull(),
  status: quotaReservationStatus("status").notNull().default("reserved"),
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }).notNull().defaultNow(),
  providerCompletedAt: timestamp("provider_completed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("quota_reservations_reconcile_idx").on(table.status, table.heartbeatAt)]);

export const quotaSettlementOutbox = pgTable("quota_settlement_outbox", {
  id: uuid("id").primaryKey().defaultRandom(),
  reservationId: uuid("reservation_id").notNull().references(() => quotaReservations.id, { onDelete: "cascade" }),
  action: quotaOutboxAction("action").notNull(),
  status: quotaOutboxStatus("status").notNull().default("pending"),
  payload: jsonb("payload").notNull(),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
}, (table) => [uniqueIndex("quota_settlement_outbox_reservation_action_uq").on(table.reservationId, table.action), index("quota_settlement_outbox_pending_idx").on(table.status, table.createdAt)]);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    result: text("result").notNull(),
    requestId: text("request_id").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("audit_events_request_action_uq").on(table.requestId, table.action),
    index("audit_events_user_created_idx").on(table.userId, table.createdAt),
  ],
);
