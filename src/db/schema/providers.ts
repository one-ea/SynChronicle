import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { projects } from "./projects.js";
import { runs } from "./runtime.js";

export const credentialStatus = pgEnum("credential_status", ["active", "revoked", "invalid"]);
export const modelStatus = pgEnum("model_status", ["active", "disabled"]);

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
  ],
);

export const providerCredentials = pgTable(
  "provider_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    ciphertext: text("ciphertext").notNull(),
    encryptedDataKey: text("encrypted_data_key").notNull(),
    algorithmVersion: integer("algorithm_version").notNull(),
    keyVersion: integer("key_version").notNull(),
    status: credentialStatus("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("provider_credentials_user_provider_uq").on(table.userId, table.provider),
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

export const quotaLedger = pgTable(
  "quota_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id"),
    runId: uuid("run_id"),
    source: text("source").notNull(),
    amount: numeric("amount", { precision: 18, scale: 8 }).notNull(),
    balance: numeric("balance", { precision: 18, scale: 8 }).notNull(),
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
  ],
);

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
