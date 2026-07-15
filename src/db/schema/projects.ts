import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth.js";

export const projectStatus = pgEnum("project_status", ["active", "archived"]);
export const artifactStatus = pgEnum("artifact_status", ["draft", "committed"]);
export const chapterStatus = pgEnum("chapter_status", ["planned", "draft", "review", "complete"]);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    status: projectStatus("status").notNull().default("active"),
    version: integer("version").notNull().default(1),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("projects_user_status_idx").on(table.userId, table.status)],
);

export const artifacts = pgTable(
  "artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    contentJson: jsonb("content_json"),
    contentText: text("content_text"),
    status: artifactStatus("status").notNull().default("draft"),
    version: integer("version").notNull().default(1),
    summary: text("summary"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("artifacts_project_type_version_uq").on(table.projectId, table.type, table.version),
    index("artifacts_user_project_idx").on(table.userId, table.projectId),
  ],
);

export const chapters = pgTable(
  "chapters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    status: chapterStatus("status").notNull().default("planned"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("chapters_project_sequence_uq").on(table.projectId, table.sequence),
    index("chapters_user_project_idx").on(table.userId, table.projectId),
  ],
);
