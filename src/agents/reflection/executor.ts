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
  previousCandidate?: ExecutionCandidate<unknown>;
  signal?: AbortSignal;
}

export interface ExecutionCandidate<T> {
  output: T;
  reviewContent: string;
  stagedArtifactIds: string[];
  artifacts?: Array<{ target: string; content: string }>;
}

export type ReflectionEvent =
  | { id?: string; sequence?: number; type: "reflection.started"; maxRounds: number }
  | { id?: string; sequence?: number; type: "revision.started"; round: number; issues: string[] }
  | { id?: string; sequence?: number; type: "review.completed"; round: number; score: number; passed: boolean }
  | { id?: string; sequence?: number; type: "reflection.completed"; rounds: number; score: number; passed: boolean };

export interface ReflectionExecutionState<T> {
  version: 1;
  executionId: string;
  status: "running" | "selected" | "completed";
  task: ReflectionTask;
  nextRound: number;
  candidates: ReflectionCandidate<T>[];
  revisionInstructions: string[];
  priorIssues: ReviewIssue[];
  pendingCandidate?: { round: number; execution: ExecutionCandidate<T> };
  selectedResult?: ReflectiveResult<T>;
}

export interface ReflectionStateStore<T> {
  load(): Promise<ReflectionExecutionState<T> | null>;
  save(state: ReflectionExecutionState<T>): Promise<void>;
}

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
  hardStop?: boolean;
  onEvent?: (event: ReflectionEvent) => unknown;
  onEventError?: (error: unknown) => void;
  emitCompleted?: boolean;
  executionId?: string;
  stateStore?: ReflectionStateStore<T>;
}

export class ReflectiveExecutor<T> {
  private readonly executeCandidate: ReflectiveExecutorOptions<T>["execute"];
  private readonly reviewer: ReviewerLike;
  private readonly role: AgentRole;
  private readonly maxRounds: number;
  private readonly passThreshold: number;
  private readonly hasBudget: () => boolean;
  private readonly hardStop: boolean;
  private readonly onEvent?: ReflectiveExecutorOptions<T>["onEvent"];
  private readonly onEventError?: ReflectiveExecutorOptions<T>["onEventError"];
  private readonly emitCompleted: boolean;
  private readonly executionId: string;
  private readonly stateStore?: ReflectionStateStore<T>;

  constructor({
    execute,
    reviewer,
    role,
    maxRounds = 3,
    passThreshold = 85,
    hasBudget = () => true,
    hardStop = false,
    onEvent,
    onEventError,
    emitCompleted = true,
    executionId = crypto.randomUUID(),
    stateStore,
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
    this.hardStop = hardStop;
    this.onEvent = onEvent;
    this.onEventError = onEventError;
    this.emitCompleted = emitCompleted;
    this.executionId = executionId;
    this.stateStore = stateStore;
  }

  async execute(task: ReflectionTask, signal?: AbortSignal): Promise<ReflectiveResult<T>> {
    const restored = await this.stateStore?.load();
    if (restored?.executionId === this.executionId && restored.status !== "completed" && !sameTask(restored.task, task)) {
      throw new Error("current request does not match persisted reflection task");
    }
    if (restored?.executionId === this.executionId && restored.status === "selected" && restored.selectedResult) return restored.selectedResult;
    const state: ReflectionExecutionState<T> = restored?.executionId === this.executionId && restored.status === "running"
      ? restored
      : { version: 1, executionId: this.executionId, status: "running", task, nextRound: 1, candidates: [], revisionInstructions: [], priorIssues: [] };
    const candidates = state.candidates;
    const activeTask = state.task;
    let revisionInstructions = state.revisionInstructions;
    let priorIssues = state.priorIssues;
    const rubric = getReviewRubric(this.role, this.passThreshold);

    signal?.throwIfAborted();
    await this.stateStore?.save(state);
    await this.emit({ type: "reflection.started", maxRounds: this.maxRounds });
    for (let round = state.nextRound; round <= this.maxRounds; round++) {
      signal?.throwIfAborted();
      if (this.hardStop && !this.hasBudget()) {
        return this.finalizeAvailable(candidates, state, "budget_exhausted");
      }

      if (round > 1) await this.emit({ type: "revision.started", round, issues: priorIssues.map((issue) => `${issue.dimension}: ${issue.recommendation}`) });
      const execution = state.pendingCandidate?.round === round
        ? state.pendingCandidate.execution
        : await this.executeCandidate({ task: activeTask, round, revisionInstructions, priorIssues, previousCandidate: candidates.at(-1) ? candidateSnapshot(candidates.at(-1)!) : undefined, signal });
      state.pendingCandidate = { round, execution };
      await this.stateStore?.save(state);
      signal?.throwIfAborted();
      if (this.hardStop && !this.hasBudget()) return this.finalizeAvailable(candidates, state, "budget_exhausted");
      const rawReview = await waitForAbort(this.reviewer.review({
        objective: activeTask.objective,
        constraints: activeTask.constraints,
        candidate: reviewCandidate(execution),
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
        reviewContent: execution.reviewContent,
        artifacts: execution.artifacts,
      };
      candidates.push(candidate);
      state.pendingCandidate = undefined;
      state.nextRound = round + 1;
      revisionInstructions = review.revisionInstructions;
      priorIssues = review.issues;
      state.revisionInstructions = revisionInstructions;
      state.priorIssues = priorIssues;
      await this.stateStore?.save(state);
      await this.emit({ type: "review.completed", round, score: review.score, passed: review.passed });

      if (review.passed) return this.finalizeAndSave(candidate, candidates.length, state);
      if (this.hardStop && !this.hasBudget()) return this.finalizeAvailable(candidates, state, "budget_exhausted");
    }

    return this.finalizeAndSave(this.selectBest(candidates), candidates.length, state, "quality_threshold_unmet");
  }

  private async finalizeAvailable(
    candidates: ReflectionCandidate<T>[],
    state: ReflectionExecutionState<T>,
    riskCode: "budget_exhausted",
  ): Promise<ReflectiveResult<T>> {
    if (candidates.length === 0) {
      throw new Error("reflection stopped before any candidate was reviewed");
    }
    return this.finalizeAndSave(this.selectBest(candidates), candidates.length, state, riskCode);
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
      executionId: this.executionId,
      output: candidate.output,
      rounds,
      finalReview: candidate.review,
      stagedArtifactIds: candidate.stagedArtifactIds,
      ...(riskCode
        ? { qualityRisk: { code: riskCode, score: candidate.review.score, unresolvedIssues: candidate.review.issues } }
        : {}),
    };
    return result;
  }

  private async finalizeAndSave(candidate: ReflectionCandidate<T>, rounds: number, state: ReflectionExecutionState<T>, riskCode?: "quality_threshold_unmet" | "budget_exhausted") {
    const result = this.finalize(candidate, rounds, riskCode);
    state.status = "selected";
    state.selectedResult = result;
    await this.stateStore?.save(state);
    if (this.emitCompleted) await this.emit({ type: "reflection.completed", rounds, score: candidate.review.score, passed: candidate.review.passed });
    return result;
  }

  private async emit(event: ReflectionEvent): Promise<void> {
    const stable = withStableEventIdentity(this.executionId, event);
    try {
      await this.onEvent?.(stable);
    } catch (error) {
      try {
        this.onEventError?.(error);
      } catch {
        // Observation failures must not affect reflective execution.
      }
    }
  }
}

function withStableEventIdentity(executionId: string, event: ReflectionEvent): ReflectionEvent {
  const index = event.type === "reflection.started" ? 0
    : event.type === "revision.started" ? event.round * 2 - 1
      : event.type === "review.completed" ? event.round * 2
        : event.rounds * 2 + 1;
  return { ...event, id: `${executionId}:${index}:${event.type}`, sequence: index };
}

function reviewCandidate<T>(execution: ExecutionCandidate<T>): string {
  if (!execution.artifacts?.length) return execution.reviewContent;
  return JSON.stringify({ artifacts: execution.artifacts }, null, 2);
}

function candidateSnapshot<T>(candidate: ReflectionCandidate<T>): ExecutionCandidate<unknown> {
  return { output: candidate.output, reviewContent: candidate.reviewContent ?? (typeof candidate.output === "string" ? candidate.output : JSON.stringify(candidate.output)), stagedArtifactIds: candidate.stagedArtifactIds, artifacts: candidate.artifacts };
}

export function sameTask(left: ReflectionTask, right: ReflectionTask) {
  return left.objective === right.objective && left.constraints.length === right.constraints.length && left.constraints.every((value, index) => value === right.constraints[index]);
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
