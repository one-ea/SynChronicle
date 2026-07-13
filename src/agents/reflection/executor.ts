import { getReviewRubric } from "./rubrics.js";
import type { ReviewRequest } from "./reviewer.js";
import type { AgentRole, ReflectionCandidate, ReflectiveResult, ReviewIssue, ReviewResult } from "./types.js";

export interface ReflectionTask {
  objective: string;
  constraints: string[];
}

export interface ExecutionContext {
  task: ReflectionTask;
  round: number;
  revisionInstructions: string[];
  priorIssues: ReviewIssue[];
  signal?: AbortSignal;
}

export interface ExecutionCandidate<T> {
  output: T;
  reviewContent: string;
  stagedArtifactIds: string[];
}

export type ReflectionEvent =
  | { type: "reflection.started"; maxRounds: number }
  | { type: "review.completed"; round: number; score: number; passed: boolean }
  | { type: "reflection.completed"; rounds: number; score: number; passed: boolean };

interface ReviewerLike {
  review(request: ReviewRequest, signal?: AbortSignal): Promise<ReviewResult>;
}

export interface ReflectiveExecutorOptions<T> {
  execute(context: ExecutionContext): Promise<ExecutionCandidate<T>>;
  reviewer: ReviewerLike;
  role: AgentRole;
  maxRounds?: number;
  passThreshold?: number;
  hasBudget?: () => boolean;
  onEvent?: (event: ReflectionEvent) => void;
  onEventError?: (error: unknown) => void;
  emitCompleted?: boolean;
}

export class ReflectiveExecutor<T> {
  private readonly executeCandidate: ReflectiveExecutorOptions<T>["execute"];
  private readonly reviewer: ReviewerLike;
  private readonly role: AgentRole;
  private readonly maxRounds: number;
  private readonly passThreshold: number;
  private readonly hasBudget: () => boolean;
  private readonly onEvent?: ReflectiveExecutorOptions<T>["onEvent"];
  private readonly onEventError?: ReflectiveExecutorOptions<T>["onEventError"];
  private readonly emitCompleted: boolean;

  constructor({
    execute,
    reviewer,
    role,
    maxRounds = 3,
    passThreshold = 85,
    hasBudget = () => true,
    onEvent,
    onEventError,
    emitCompleted = true,
  }: ReflectiveExecutorOptions<T>) {
    if (!Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > 3) {
      throw new RangeError("maxRounds must be an integer between 1 and 3");
    }
    if (!Number.isFinite(passThreshold) || passThreshold < 0 || passThreshold > 100) {
      throw new RangeError("passThreshold must be a finite number between 0 and 100");
    }
    this.executeCandidate = execute;
    this.reviewer = reviewer;
    this.role = role;
    this.maxRounds = maxRounds;
    this.passThreshold = passThreshold;
    this.hasBudget = hasBudget;
    this.onEvent = onEvent;
    this.onEventError = onEventError;
    this.emitCompleted = emitCompleted;
  }

  async execute(task: ReflectionTask, signal?: AbortSignal): Promise<ReflectiveResult<T>> {
    const candidates: ReflectionCandidate<T>[] = [];
    let revisionInstructions: string[] = [];
    let priorIssues: ReviewIssue[] = [];
    const rubric = getReviewRubric(this.role, this.passThreshold);

    signal?.throwIfAborted();
    this.emit({ type: "reflection.started", maxRounds: this.maxRounds });

    for (let round = 1; round <= this.maxRounds; round++) {
      signal?.throwIfAborted();
      if (!this.hasBudget()) {
        return this.finalizeAvailable(candidates, "budget_exhausted");
      }

      const execution = await this.executeCandidate({ task, round, revisionInstructions, priorIssues, signal });
      signal?.throwIfAborted();
      const rawReview = await waitForAbort(this.reviewer.review({
        objective: task.objective,
        constraints: task.constraints,
        candidate: execution.reviewContent,
        rubric,
        priorIssues: priorIssues.map((issue) => issue.recommendation),
      }, signal), signal);
      signal?.throwIfAborted();
      const review = { ...rawReview, passed: rawReview.score >= rubric.threshold };
      const candidate: ReflectionCandidate<T> = {
        round,
        output: execution.output,
        review,
        stagedArtifactIds: execution.stagedArtifactIds,
      };
      candidates.push(candidate);
      this.emit({ type: "review.completed", round, score: review.score, passed: review.passed });

      if (review.passed) return this.finalize(candidate, candidates.length);
      revisionInstructions = review.revisionInstructions;
      priorIssues = review.issues;
    }

    return this.finalize(this.selectBest(candidates), candidates.length, "quality_threshold_unmet");
  }

  private finalizeAvailable(
    candidates: ReflectionCandidate<T>[],
    riskCode: "budget_exhausted",
  ): ReflectiveResult<T> {
    if (candidates.length === 0) {
      throw new Error("reflection stopped before any candidate was reviewed");
    }
    return this.finalize(this.selectBest(candidates), candidates.length, riskCode);
  }

  private selectBest(candidates: ReflectionCandidate<T>[]): ReflectionCandidate<T> {
    return candidates.reduce((best, candidate) => candidate.review.score >= best.review.score ? candidate : best);
  }

  private finalize(
    candidate: ReflectionCandidate<T>,
    rounds: number,
    riskCode?: "quality_threshold_unmet" | "budget_exhausted",
  ): ReflectiveResult<T> {
    const result: ReflectiveResult<T> = {
      output: candidate.output,
      rounds,
      finalReview: candidate.review,
      ...(riskCode
        ? { qualityRisk: { code: riskCode, score: candidate.review.score, unresolvedIssues: candidate.review.issues } }
        : {}),
    };
    if (this.emitCompleted) this.emit({ type: "reflection.completed", rounds, score: candidate.review.score, passed: candidate.review.passed });
    return result;
  }

  private emit(event: ReflectionEvent): void {
    try {
      this.onEvent?.(event);
    } catch (error) {
      try {
        this.onEventError?.(error);
      } catch {
        // Observation failures must not affect reflective execution.
      }
    }
  }
}

function waitForAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException("The operation was aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
