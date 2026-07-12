import { z } from "zod";

export interface AgentUsageTotals {
  Input: number;
  Output: number;
  CacheRead: number;
  CacheWrite: number;
  Cost: number;
  Saved: number;
  CacheCapable: boolean;
  CacheBreaks: number;
}

export const AgentUsageTotalsSchema = z.object({
  Input: z.number().int().nonnegative(),
  Output: z.number().int().nonnegative(),
  CacheRead: z.number().int().nonnegative(),
  CacheWrite: z.number().int().nonnegative(),
  Cost: z.number().nonnegative(),
  Saved: z.number().nonnegative(),
  CacheCapable: z.boolean(),
  CacheBreaks: z.number().int().nonnegative(),
});

export interface UsageState {
  Schema: number;
  UpdatedAt: string;
  Overall: AgentUsageTotals;
  PerAgent: Record<string, AgentUsageTotals>;
  PerModel: Record<string, AgentUsageTotals>;
  MissingUsage: number;
}

export const UsageStateSchema = z.object({
  Schema: z.number().int().nonnegative(),
  UpdatedAt: z.string(),
  Overall: AgentUsageTotalsSchema,
  PerAgent: z.record(z.string(), AgentUsageTotalsSchema),
  PerModel: z.record(z.string(), AgentUsageTotalsSchema),
  MissingUsage: z.number().int().nonnegative(),
});