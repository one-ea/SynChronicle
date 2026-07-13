import { z } from "zod";
import { ReflectionConfigSchema } from "../agents/reflection/schemas.js";

const JsonObjectSchema = z.record(z.unknown());

export const ModelRefSchema = z.object({
  provider: z.string(),
  model: z.string(),
});

export const ProviderConfigSchema = z.object({
  type: z.string().optional(),
  api: z.string().optional(),
  api_key: z.string().optional(),
  base_url: z.string().optional(),
  models: z.array(z.string()).optional(),
  extra_body: JsonObjectSchema.optional(),
  extra: JsonObjectSchema.optional(),
});

export const RoleConfigSchema = z.object({
  provider: z.string(),
  model: z.string(),
  fallbacks: z.array(ModelRefSchema).optional(),
  reasoning_effort: z.string().optional(),
});

export const BudgetConfigSchema = z.object({
  book_usd: z.number().optional(),
  warn_ratio: z.number().optional(),
  hard_stop: z.boolean().optional(),
});

export const NotifyConfigSchema = z.object({
  enabled: z.boolean().optional(),
  command: z.string().optional(),
  events: z.array(z.string()).optional(),
});

export const ConfigSchema = z.object({
  output_dir: z.string().optional(),
  provider: z.string(),
  model: z.string(),
  reasoning_effort: z.string().optional(),
  providers: z.record(ProviderConfigSchema).default({}),
  roles: z.record(RoleConfigSchema).default({}),
  style: z.string().optional(),
  context_window: z.number().int().optional(),
  budget: BudgetConfigSchema.optional(),
  notify: NotifyConfigSchema.optional(),
  reflection: ReflectionConfigSchema,
});

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type ModelRef = z.infer<typeof ModelRefSchema>;
export type RoleConfig = z.infer<typeof RoleConfigSchema>;
export type BudgetConfig = z.infer<typeof BudgetConfigSchema>;
export type NotifyConfig = z.infer<typeof NotifyConfigSchema>;
export type Config = z.infer<typeof ConfigSchema>;
export type ConfigInput = z.input<typeof ConfigSchema>;
export type PartialConfig = Omit<Partial<ConfigInput>, "providers" | "roles"> & {
  providers?: Record<string, ProviderConfig>;
  roles?: Record<string, Partial<RoleConfig>>;
};
