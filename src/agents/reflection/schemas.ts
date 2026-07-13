import { z } from "zod";

export const ReviewIssueSchema = z.object({
  dimension: z.string().min(1),
  severity: z.enum(["low", "medium", "high"]),
  evidence: z.string().min(1),
  recommendation: z.string().min(1),
}).strict();

export const ReviewResultSchema = z.object({
  score: z.number().min(0).max(100),
  passed: z.boolean(),
  summary: z.string(),
  issues: z.array(ReviewIssueSchema),
  revisionInstructions: z.array(z.string().min(1)),
}).strict();

export const ReflectionConfigSchema = z.object({
  enabled: z.boolean().default(true),
  max_rounds: z.number().int().min(1).max(3).default(3),
  pass_threshold: z.number().min(0).max(100).default(85),
  review_retry_limit: z.number().int().min(0).max(3).default(2),
  reviewer_model: z.string().min(1).optional(),
}).default({});
