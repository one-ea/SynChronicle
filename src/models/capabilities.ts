import { z } from "zod";

export const CREDENTIAL_POLICY_VIOLATION = "credential_policy_violation";
export const PARAMETER_OUT_OF_RANGE = "parameter_out_of_range";
export const CAPABILITY_UNSUPPORTED = "capability_unsupported";

export const PlatformModelCapabilitiesSchema = z.object({
  contextWindow: z.number().int().nonnegative().default(0),
  maxOutputTokens: z.number().int().nonnegative().default(0),
  pricing: z.object({
    inputPer1M: z.number().min(0).default(0),
    outputPer1M: z.number().min(0).default(0),
    cacheReadPer1M: z.number().min(0).optional(),
    cacheWritePer1M: z.number().min(0).optional(),
  }).default({}),
  modalities: z.object({
    text: z.boolean().default(true),
    vision: z.boolean().default(false),
    audio: z.boolean().default(false),
  }).default({}),
  tools: z.object({
    toolCalling: z.boolean().default(false),
    structuredOutput: z.boolean().default(false),
    jsonMode: z.boolean().default(false),
  }).default({}),
  generation: z.object({
    streaming: z.boolean().default(true),
    temperature: z.object({ min: z.number().default(0), max: z.number().default(2) }).default({}),
    reasoningEffort: z.array(z.enum(["low", "medium", "high"])).default([]),
    systemPrompt: z.boolean().default(true),
  }).default({}),
  policy: z.object({
    allowPlatformCredential: z.boolean().default(true),
    allowUserCredential: z.boolean().default(true),
    tags: z.array(z.string()).default([]),
  }).default({}),
});

export type PlatformModelCapabilities = z.infer<typeof PlatformModelCapabilitiesSchema>;

export function defaultPlatformModelCapabilities(): PlatformModelCapabilities {
  return PlatformModelCapabilitiesSchema.parse({});
}

export function normalizePlatformModelCapabilities(input: unknown): PlatformModelCapabilities {
  if (!input || typeof input !== "object" || Array.isArray(input)) return defaultPlatformModelCapabilities();
  return PlatformModelCapabilitiesSchema.parse(input);
}

export interface CatalogEntry {
  provider: string;
  model: string;
  status: "active" | "disabled";
  capabilities: PlatformModelCapabilities;
  priceKnown: boolean;
  credentialSource?: "environment" | "encrypted";
}

export const CATALOG_ENTRY_SCHEMA = z.object({
  provider: z.string(),
  model: z.string(),
  status: z.enum(["active", "disabled"]),
  capabilities: PlatformModelCapabilitiesSchema,
  priceKnown: z.boolean(),
  credentialSource: z.enum(["environment", "encrypted"]).optional(),
});

export interface SelectionInput {
  provider: string;
  model: string;
  credentialId?: string;
  parameters?: {
    temperature?: number;
    maxTokens?: number;
    reasoningEffort?: "low" | "medium" | "high";
  };
}

export interface SelectionPolicy {
  allowPlatformCredential: boolean;
  allowUserCredential?: boolean;
}

export function assertSelectionAllowed(
  selection: SelectionInput,
  catalogEntry: { capabilities: PlatformModelCapabilities },
  policy: SelectionPolicy,
): void {
  const caps = catalogEntry.capabilities;

  if (selection.credentialId && policy.allowUserCredential === false) {
    throw new Error(`${CREDENTIAL_POLICY_VIOLATION}: user credentials not allowed for this model`);
  }
  if (!selection.credentialId && !policy.allowPlatformCredential) {
    throw new Error(`${CREDENTIAL_POLICY_VIOLATION}: platform credential not allowed for this model`);
  }

  if (selection.parameters?.temperature !== undefined) {
    const t = selection.parameters.temperature;
    const { min, max } = caps.generation.temperature;
    if (t < min || t > max) throw new Error(`${PARAMETER_OUT_OF_RANGE}: temperature ${t} not in [${min}, ${max}]`);
  }

  if (selection.parameters?.maxTokens !== undefined) {
    if (selection.parameters.maxTokens > caps.maxOutputTokens) {
      throw new Error(`${PARAMETER_OUT_OF_RANGE}: maxTokens ${selection.parameters.maxTokens} exceeds model limit ${caps.maxOutputTokens}`);
    }
  }

  if (selection.parameters?.reasoningEffort !== undefined) {
    if (!caps.generation.reasoningEffort.includes(selection.parameters.reasoningEffort)) {
      throw new Error(`${CAPABILITY_UNSUPPORTED}: reasoningEffort ${selection.parameters.reasoningEffort} not supported`);
    }
  }
}
