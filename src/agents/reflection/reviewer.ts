import { generateText, type LanguageModel } from "ai";
import { ReviewResultSchema } from "./schemas.js";
import type { ReviewResult } from "./types.js";
import type { ReviewRubric } from "./rubrics.js";

type LanguageModelInstance = Exclude<LanguageModel, string>;
type Generate = typeof generateText;

export interface ReviewRequest {
  objective: string;
  constraints: string[];
  candidate: string;
  rubric: ReviewRubric;
  priorIssues: string[];
}

export interface ReviewerOptions {
  model: LanguageModelInstance;
  generate?: Generate;
  retryLimit?: number;
  onUsage?: (name: string, usage: unknown) => void;
  onUsageError?: (error: unknown) => void;
}

export class ReviewerError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ReviewerError";
  }
}

export class Reviewer {
  private readonly model: LanguageModelInstance;
  private readonly generate: Generate;
  private readonly retryLimit: number;
  private readonly onUsage?: ReviewerOptions["onUsage"];
  private readonly onUsageError?: ReviewerOptions["onUsageError"];

  constructor({ model, generate = generateText, retryLimit = 2, onUsage, onUsageError }: ReviewerOptions) {
    if (!Number.isInteger(retryLimit) || retryLimit < 0 || retryLimit > 3) {
      throw new RangeError("retryLimit must be an integer between 0 and 3");
    }
    this.model = model;
    this.generate = generate;
    this.retryLimit = retryLimit;
    this.onUsage = onUsage;
    this.onUsageError = onUsageError;
  }

  async review(request: ReviewRequest): Promise<ReviewResult> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.retryLimit; attempt++) {
      let raw: Awaited<ReturnType<Generate>>;
      try {
        raw = await this.generate({ model: this.model, prompt: buildReviewPrompt(request) });
      } catch (error) {
        lastError = error;
        continue;
      }

      this.reportUsage(raw.usage);
      try {
        const parsed = ReviewResultSchema.parse(JSON.parse(raw.text));
        return { ...parsed, passed: parsed.score >= request.rubric.threshold };
      } catch (error) {
        lastError = error;
      }
    }

    throw new ReviewerError(`review failed after ${this.retryLimit + 1} attempts`, { cause: lastError });
  }

  private reportUsage(usage: unknown): void {
    try {
      this.onUsage?.("reviewer", usage);
    } catch (error) {
      try {
        this.onUsageError?.(error);
      } catch {
        // Usage reporting must not affect review execution.
      }
    }
  }
}

function buildReviewPrompt(request: ReviewRequest): string {
  return [
    "Review the candidate independently. Return only JSON matching the review result schema.",
    `Objective: ${request.objective}`,
    `Constraints: ${JSON.stringify(request.constraints)}`,
    `Rubric: ${JSON.stringify(request.rubric)}`,
    `Prior issues: ${JSON.stringify(request.priorIssues)}`,
    `Candidate: ${request.candidate}`,
  ].join("\n");
}
