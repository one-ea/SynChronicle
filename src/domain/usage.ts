import { z } from "zod";
export const AgentUsageTotalsSchema = z.object({ input: z.number().int().nonnegative(), output: z.number().int().nonnegative(), cache_read: z.number().int().nonnegative(), cache_write: z.number().int().nonnegative(), cost_usd: z.number().nonnegative(), saved_usd: z.number().nonnegative(), cache_capable: z.boolean(), cache_breaks: z.number().int().nonnegative().optional(), latency_ms: z.number().nonnegative().optional() }).strict();
export type AgentUsageTotals = z.infer<typeof AgentUsageTotalsSchema>;
export const UsageStateSchema = z.object({ schema: z.number().int().nonnegative(), updated_at: z.string(), overall: AgentUsageTotalsSchema, per_agent: z.record(z.string(), AgentUsageTotalsSchema), per_model: z.record(z.string(), AgentUsageTotalsSchema).optional(), unknown_cost_models: z.array(z.string()).optional(), missing_assistant_usage: z.number().int().nonnegative() }).strict();
export type UsageState = z.infer<typeof UsageStateSchema>;
export const UsageSchema = UsageStateSchema; export type Usage = UsageState;
export const WritingStatsSchema = z.object({ total_words: z.number().int().nonnegative(), chapters: z.number().int().nonnegative() }).strict(); export type WritingStats = z.infer<typeof WritingStatsSchema>;
