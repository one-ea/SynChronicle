import { z } from "zod";

const ParametersSchema = z.object({
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().max(1_000_000).optional(),
  reasoningEffort: z.enum(["low", "medium", "high"]).optional(),
}).strict();

export const AgentModelSelectionSchema = z.object({
  provider: z.string().trim().min(1).max(100),
  model: z.string().trim().min(1).max(200),
  credentialId: z.string().uuid().optional(),
  parameters: ParametersSchema.default({}),
}).strict();

export const ModelSetInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  agents: z.record(z.string().trim().min(1).max(100), AgentModelSelectionSchema).refine((value) => Object.keys(value).length > 0),
}).strict();

export type ModelSetInput = z.infer<typeof ModelSetInputSchema>;
export type ModelConfigurationSnapshot = ModelSetInput & { modelSetId: string; version: number };
export interface ModelCatalog {
  credentials: Array<{ id: string; provider: string; label?: string }>;
  platformModels: Array<{ provider: string; model: string }>;
}

export function validateModelSetInput(input: unknown, catalog: ModelCatalog): ModelSetInput {
  const parsed = ModelSetInputSchema.parse(input);
  for (const selection of Object.values(parsed.agents)) {
    if (selection.credentialId) {
      const credential = catalog.credentials.find(({ id }) => id === selection.credentialId);
      if (!credential || credential.provider !== selection.provider) throw new Error("Invalid credential reference");
      const providerModels = catalog.platformModels.filter(({ provider }) => provider === selection.provider);
      if (providerModels.length && !providerModels.some(({ model }) => model === selection.model)) throw new Error("Invalid provider model");
      continue;
    }
    const knownProvider = catalog.platformModels.some(({ provider }) => provider === selection.provider);
    if (!knownProvider) throw new Error("Provider is unavailable");
    if (!catalog.platformModels.some(({ provider, model }) => provider === selection.provider && model === selection.model)) throw new Error("Invalid platform model");
  }
  return parsed;
}
