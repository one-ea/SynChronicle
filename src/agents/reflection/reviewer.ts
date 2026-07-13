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

  constructor({ model, generate = generateText, retryLimit = 2, onUsage }: ReviewerOptions) {
    this.model = model;
    this.generate = generate;
    this.retryLimit = retryLimit;
    this.onUsage = onUsage;
  }

  async review(request: ReviewRequest): Promise<ReviewResult> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.retryLimit; attempt++) {
      try {
        const raw = await this.generate({ model: this.model, prompt: buildReviewPrompt(request) });
        this.onUsage?.("reviewer", raw.usage);
        const parsed = ReviewResultSchema.parse(JSON.parse(raw.text));
        return { ...parsed, passed: parsed.score >= request.rubric.threshold };
      } catch (error) {
        lastError = error;
      }
    }

    throw new ReviewerError("review failed", { cause: lastError });
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
