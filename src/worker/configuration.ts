import type { Config } from "../config/schemas.js";

interface SnapshotSelection {
  provider: string;
  model: string;
  parameters?: { reasoningEffort?: string };
}

export function applyRunConfiguration(base: Config, payload: unknown): Config {
  if (!payload || typeof payload !== "object") return base;
  const snapshot = (payload as Record<string, unknown>).configurationSnapshot;
  if (!snapshot || typeof snapshot !== "object") return base;
  const agents = (snapshot as Record<string, unknown>).agents;
  if (!agents || typeof agents !== "object" || Array.isArray(agents)) return base;
  const roles = { ...(base.roles ?? {}) };
  for (const [role, candidate] of Object.entries(agents)) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const selection = candidate as Partial<SnapshotSelection>;
    if (typeof selection.provider !== "string" || typeof selection.model !== "string") continue;
    if (!base.providers?.[selection.provider]) throw new Error(`provider ${JSON.stringify(selection.provider)} is not configured for this worker`);
    roles[role] = { provider: selection.provider, model: selection.model, reasoning_effort: selection.parameters?.reasoningEffort };
  }
  return { ...base, roles };
}
