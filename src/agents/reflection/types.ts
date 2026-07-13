import { z } from "zod";
import { ReviewIssueSchema, ReviewResultSchema } from "./schemas.js";

export type AgentRole = "architect" | "writer" | "editor";
export type ReviewIssue = z.infer<typeof ReviewIssueSchema>;
export type ReviewResult = z.infer<typeof ReviewResultSchema>;

export interface ReflectionCandidate<T> {
  round: number;
  output: T;
  review: ReviewResult;
  stagedArtifactIds: string[];
}

export interface QualityRisk {
  code: "quality_threshold_unmet" | "budget_exhausted";
  score: number;
  unresolvedIssues: ReviewIssue[];
}

export interface ReflectiveResult<T> {
  executionId?: string;
  output: T;
  rounds: number;
  finalReview: ReviewResult;
  stagedArtifactIds?: string[];
  qualityRisk?: QualityRisk;
}
