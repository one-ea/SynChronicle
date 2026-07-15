import type { RunResumeData } from "../scheduler/types.js";

export type WorkerBoundary = "agent" | "commit:enter" | "commit:exit";
export type TaskErrorCategory = "transient" | "invalid_input" | "invalid_config" | "lease_loss" | "cancel" | "internal";

export class TaskExecutionError extends Error {
  readonly category: TaskErrorCategory;
  constructor(message: string, readonly retryable: boolean, options: ErrorOptions & { category?: TaskErrorCategory } = {}) {
    super(message, options);
    this.name = "TaskExecutionError";
    this.category = options.category ?? "internal";
  }
}

export function taskError(error: unknown, attempts: number, maxAttempts: number): TaskExecutionError {
  if (error instanceof TaskExecutionError) return error;
  const cause = error instanceof Error ? error : new Error(String(error));
  const category = classifyError(cause);
  return new TaskExecutionError(cause.message, category === "transient" && attempts < maxAttempts, { cause, category });
}

export function taskPrompt(payload: unknown): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TaskExecutionError("invalid task payload", false, { category: "invalid_input" });
  }
  const prompt = (payload as { prompt?: unknown }).prompt;
  if (typeof prompt !== "string" || !prompt.trim()) {
    throw new TaskExecutionError("task payload prompt is required", false, { category: "invalid_input" });
  }
  return prompt.trim();
}

export function pendingSteer(control: RunResumeData) { return control.steerCommands; }

function classifyError(error: Error): TaskErrorCategory {
  const value = `${error.name} ${error.message}`.toLowerCase();
  const code = String((error as Error & { code?: unknown }).code ?? "").toUpperCase();
  const status = Number((error as Error & { status?: unknown; statusCode?: unknown }).status ?? (error as Error & { statusCode?: unknown }).statusCode);
  if (value.includes("lease ownership lost")) return "lease_loss";
  if (value.includes("abort") || value.includes("cancel") || value.includes("shutdown")) return "cancel";
  if (value.includes("config") || value.includes("api key") || value.includes("credential")) return "invalid_config";
  if (value.includes("invalid") || value.includes("required") || value.includes("validation")) return "invalid_input";
  if (status === 429 || status >= 500 || ["40001", "40P01"].includes(code) || code.startsWith("ECONN") || value.includes("timeout") || value.includes("rate limit") || value.includes("unavailable") || value.includes("database") || value.includes("deadlock")) return "transient";
  return "internal";
}
