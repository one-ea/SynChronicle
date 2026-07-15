import { generateText, type LanguageModel } from "ai";
import { ReviewResultSchema } from "./schemas.js";
import type { ReviewResult } from "./types.js";
import type { ReviewRubric } from "./rubrics.js";
import { usageModelIdentity } from "../../providers/failover.js";

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
  onUsage?: (name: string, usage: unknown, model?: { provider: string; model: string }) => void;
  onUsageError?: (error: unknown) => void;
  now?: () => number;
  canContinue?: () => boolean;
  generationOptions?: () => { temperature?: number; maxTokens?: number };
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
  private readonly now: () => number;
  private readonly canContinue: () => boolean;
  private readonly generationOptions?: ReviewerOptions["generationOptions"];

  constructor({ model, generate = generateText, retryLimit = 2, onUsage, onUsageError, now = () => performance.now(), canContinue = () => true, generationOptions }: ReviewerOptions) {
    if (!Number.isInteger(retryLimit) || retryLimit < 0 || retryLimit > 3) {
      throw new RangeError("retryLimit must be an integer between 0 and 3");
    }
    this.model = model;
    this.generate = generate;
    this.retryLimit = retryLimit;
    this.onUsage = onUsage;
    this.onUsageError = onUsageError;
    this.now = now;
    this.canContinue = canContinue;
    this.generationOptions = generationOptions;
  }

  async review(request: ReviewRequest, signal?: AbortSignal): Promise<ReviewResult> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.retryLimit; attempt++) {
      signal?.throwIfAborted();
      if (!this.canContinue()) throw new ReviewerError("review stopped by budget policy", { cause: lastError });
      let raw: Awaited<ReturnType<Generate>>;
      const startedAt = this.now();
      try {
        const options = this.generationOptions?.() ?? {};
        raw = await this.generate({
          model: this.model,
          prompt: buildReviewPrompt(request),
          ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
          ...(options.maxTokens === undefined ? {} : { maxOutputTokens: options.maxTokens }),
          ...(signal ? { abortSignal: signal } : {}),
        });
      } catch (error) {
        this.reportUsage({ latencyMs: Math.max(0, this.now() - startedAt) });
        signal?.throwIfAborted();
        lastError = error;
        continue;
      }

      this.reportUsage(withLatency(raw.usage, Math.max(0, this.now() - startedAt)));
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
      this.onUsage?.("reviewer", usage, usageModelIdentity(usage) ?? (this.model.provider && this.model.modelId ? { provider: this.model.provider, model: this.model.modelId } : undefined));
    } catch (error) {
      try {
        this.onUsageError?.(error);
      } catch {
        // Usage reporting must not affect review execution.
      }
    }
  }
}

function withLatency(usage: unknown, latencyMs: number): Record<string, unknown> {
  return usage && typeof usage === "object" ? { ...usage, latencyMs } : { latencyMs };
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
