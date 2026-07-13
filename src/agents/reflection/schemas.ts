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

const ReflectionTaskSchema = z.object({ objective: z.string(), constraints: z.array(z.string()) }).strict();
const StagedArtifactSummarySchema = z.object({ target: z.string().min(1), content: z.string() }).strict();
const ExecutionCandidateSchema = z.object({
  output: z.unknown(),
  reviewContent: z.string(),
  stagedArtifactIds: z.array(z.string()),
  artifacts: z.array(StagedArtifactSummarySchema).optional(),
}).strict();
const ReflectionCandidateSchema = z.object({
  round: z.number().int().positive(),
  output: z.unknown(),
  review: ReviewResultSchema,
  stagedArtifactIds: z.array(z.string()),
  reviewContent: z.string().optional(),
  artifacts: z.array(StagedArtifactSummarySchema).optional(),
}).strict();
const ReflectiveResultSchema = z.object({
  executionId: z.string().optional(),
  output: z.unknown(),
  rounds: z.number().int().nonnegative(),
  finalReview: ReviewResultSchema,
  stagedArtifactIds: z.array(z.string()).optional(),
  qualityRisk: z.object({ code: z.enum(["quality_threshold_unmet", "budget_exhausted"]), score: z.number(), unresolvedIssues: z.array(ReviewIssueSchema) }).strict().optional(),
}).strict();

export const ReflectionExecutionStateSchema = z.object({
  version: z.literal(1),
  executionId: z.string().min(1),
  status: z.enum(["running", "selected", "completed"]),
  task: ReflectionTaskSchema,
  nextRound: z.number().int().positive(),
  candidates: z.array(ReflectionCandidateSchema),
  revisionInstructions: z.array(z.string()),
  priorIssues: z.array(ReviewIssueSchema),
  pendingCandidate: z.object({ round: z.number().int().positive(), execution: ExecutionCandidateSchema }).strict().optional(),
  selectedResult: ReflectiveResultSchema.optional(),
}).strict();

export function parseReflectionExecutionState<T>(value: unknown, label = "reflection execution state") {
  const parsed = ReflectionExecutionStateSchema.safeParse(value);
  if (!parsed.success) throw new Error(`${label} schema/version invalid: ${parsed.error.message}`);
  return parsed.data as import("./executor.js").ReflectionExecutionState<T>;
}
