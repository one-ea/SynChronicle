import type { Config } from "./schemas.js";

export const DEFAULT_CONTEXT_WINDOW = 200000;

const contextWindows: Readonly<Record<string, number>> = {
  "gpt-4o": 128000,
  "gpt-4o-mini": 128000,
  "gpt-4.1": 1047576,
  "gpt-4.1-mini": 1047576,
  "gpt-4.1-nano": 1047576,
};

export type ContextWindowSource = "config" | "registry" | "default";

export function resolveContextWindow(
  cfg: Config,
  modelName: string,
): { window: number; source: ContextWindowSource } {
  if ((cfg.context_window ?? 0) > 0) return { window: cfg.context_window as number, source: "config" };
  const window = contextWindows[modelName];
  if (window) return { window, source: "registry" };
  return { window: DEFAULT_CONTEXT_WINDOW, source: "default" };
}

export function resolveReasoningEffort(cfg: Config, role: string): string {
  if (role && role !== "default") {
    const effort = cfg.roles?.[role]?.reasoning_effort;
    if (effort) return effort;
  }
  return cfg.reasoning_effort ?? "";
}
