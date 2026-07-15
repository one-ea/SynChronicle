import type { RunResumeData } from "../scheduler/types.js";

export type WorkerBoundary = "agent" | "commit:enter" | "commit:exit";

export class TaskExecutionError extends Error {
  constructor(message: string, readonly retryable: boolean, options?: ErrorOptions) {
    super(message, options);
    this.name = "TaskExecutionError";
  }
}

export function taskError(error: unknown, attempts: number, maxAttempts: number): TaskExecutionError {
  if (error instanceof TaskExecutionError) return error;
  const cause = error instanceof Error ? error : new Error(String(error));
  return new TaskExecutionError(cause.message, attempts < maxAttempts, { cause });
}

export function taskPrompt(payload: unknown): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TaskExecutionError("invalid task payload", false);
  }
  const prompt = (payload as { prompt?: unknown }).prompt;
  if (typeof prompt !== "string" || !prompt.trim()) {
    throw new TaskExecutionError("task payload prompt is required", false);
  }
  return prompt.trim();
}

export function pendingSteer(control: RunResumeData, applied: Set<string>) {
  return control.steerCommands.filter((command) => !applied.has(command.id));
}
