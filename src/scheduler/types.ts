import type { runs, tasks } from "../db/schema/index.js";

export const LEGACY_COMMAND_ID_PREFIX = "legacy:";

export type RunRow = typeof runs.$inferSelect;
export type TaskRow = typeof tasks.$inferSelect;
export type TaskType = TaskRow["type"];
export type TaskTerminalStatus = Extract<TaskRow["status"], "completed" | "failed" | "cancelled">;

export interface EnqueueRunInput {
  idempotencyKey: string;
  type?: TaskType;
  priority?: number;
  payload?: Record<string, unknown>;
  budgetSnapshot?: Record<string, unknown>;
}

export interface ReleaseLeaseOutcome {
  status: TaskTerminalStatus | "queued" | "paused";
  scheduledAt?: Date;
}

export type RunCommand = "pause" | "resume" | "abort" | "steer";
export type RunCommandResult = RunRow | "missing" | "conflict";

export interface RunResumeData {
  desiredState: "running" | "paused" | "cancelled";
  steerCommands: Array<{ id: string; instruction: string }>;
  [key: string]: unknown;
}
