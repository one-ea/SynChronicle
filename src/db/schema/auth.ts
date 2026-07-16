import { index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["user", "admin"]);
export const userStatus = pgEnum("user_status", ["active", "suspended", "disabled"]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    username: text("username").notNull(),
    passwordHash: text("password_hash").notNull(),
    authVersion: integer("auth_version").notNull().default(1),
    role: userRole("role").notNull().default("user"),
    status: userStatus("status").notNull().default("active"),
    concurrencyLimit: integer("concurrency_limit").notNull().default(1),
    budgetUsd: numeric("budget_usd", { precision: 18, scale: 8 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("users_username_uq").on(table.username)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tokenDigest: text("token_digest").notNull(),
    authVersion: integer("auth_version").notNull().default(1),
    device: jsonb("device").notNull().default({}),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("sessions_token_digest_uq").on(table.tokenDigest),
    index("sessions_user_expires_idx").on(table.userId, table.expiresAt),
  ],
);
