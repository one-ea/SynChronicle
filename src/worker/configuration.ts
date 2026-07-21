import type { Config } from "../config/schemas.js";
import { assertSelectionAllowed } from "../models/capabilities.js";

interface SnapshotSelection {
  provider: string;
  model: string;
  credentialId?: string;
  parameters?: { reasoningEffort?: "low" | "medium" | "high"; temperature?: number; maxTokens?: number };
}

export function applyRunConfiguration(base: Config, payload: unknown): Config {
  if (!payload || typeof payload !== "object") return base;
  const snapshot = (payload as Record<string, unknown>).configurationSnapshot;
  if (!snapshot || typeof snapshot !== "object") return base;
  const agents = (snapshot as Record<string, unknown>).agents;
  if (!agents || typeof agents !== "object" || Array.isArray(agents)) return base;

  const snapCaps = (snapshot as Record<string, unknown>).capabilities;
  const capabilities = snapCaps && typeof snapCaps === "object" ? snapCaps as Record<string, Record<string, unknown>> : {};

  const roles = { ...(base.roles ?? {}) };
  for (const [role, candidate] of Object.entries(agents)) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const selection = candidate as Partial<SnapshotSelection>;
    if (typeof selection.provider !== "string" || typeof selection.model !== "string") continue;
    if (!base.providers?.[selection.provider]) throw new Error(`provider ${JSON.stringify(selection.provider)} is not configured for this worker`);

    const roleCaps = capabilities[role];
    if (roleCaps) {
      assertSelectionAllowed(
        { provider: selection.provider, model: selection.model, credentialId: selection.credentialId, parameters: selection.parameters },
        { capabilities: roleCaps as any },
        { allowPlatformCredential: true, allowUserCredential: true },
      );
    }

    roles[role] = {
      provider: selection.provider, model: selection.model,
      reasoning_effort: selection.parameters?.reasoningEffort,
      credential_id: selection.credentialId,
      temperature: selection.parameters?.temperature,
      max_tokens: selection.parameters?.maxTokens,
    };
  }
  return { ...base, roles };
}
