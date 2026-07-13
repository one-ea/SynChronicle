import { describe, expect, it, vi } from "vitest";
import { ReflectiveExecutor, type ExecutionCandidate, type ReflectionEvent } from "./executor.js";
import type { ReviewResult } from "./types.js";

const task = {
  role: "writer" as const,
  objective: "Write a tense confrontation.",
  constraints: ["Keep the characters consistent."],
};

function candidate(output: string): ExecutionCandidate<string> {
  return { output, reviewContent: output, stagedArtifactIds: [`artifact-${output}`] };
}

function reviewResult(score: number, passed = false): ReviewResult {
  return {
    score,
    passed,
    summary: `Score ${score}`,
    issues: passed ? [] : [{ dimension: "quality", severity: "medium", evidence: "gap", recommendation: "revise" }],
    revisionInstructions: passed ? [] : [`Improve ${score}`],
  };
}

function createExecutor(overrides: Partial<ConstructorParameters<typeof ReflectiveExecutor<string>>[0]> = {}) {
  return new ReflectiveExecutor<string>({
    execute: vi.fn().mockResolvedValue(candidate("v1")),
    reviewer: { review: vi.fn().mockResolvedValue(reviewResult(70)) },
    role: "writer",
    ...overrides,
  });
}

describe("ReflectiveExecutor", () => {
  it("returns the newest highest-scoring candidate after three rounds", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce(candidate("v1"))
      .mockResolvedValueOnce(candidate("v2"))
      .mockResolvedValueOnce(candidate("v3"));
    const review = vi.fn()
      .mockResolvedValueOnce(reviewResult(70))
      .mockResolvedValueOnce(reviewResult(82))
      .mockResolvedValueOnce(reviewResult(82));

    const result = await createExecutor({ execute, reviewer: { review }, maxRounds: 3 }).execute(task);

    expect(result.output).toBe("v3");
    expect(result.rounds).toBe(3);
    expect(result.qualityRisk?.code).toBe("quality_threshold_unmet");
    expect(result.finalReview.score).toBe(82);
  });

  it("returns immediately when the first round passes", async () => {
    const execute = vi.fn().mockResolvedValue(candidate("approved"));
    const review = vi.fn().mockResolvedValue(reviewResult(90, true));

    const result = await createExecutor({ execute, reviewer: { review } }).execute(task);

    expect(result).toMatchObject({ output: "approved", rounds: 1 });
    expect(result.qualityRisk).toBeUndefined();
    expect(execute).toHaveBeenCalledOnce();
  });

  it("recomputes passed from the rubric threshold when reviewer flags conflict", async () => {
    const execute = vi.fn().mockResolvedValue(candidate("high-score"));
    const highScoreReview = reviewResult(90, false);
    const highResult = await createExecutor({
      execute,
      reviewer: { review: vi.fn().mockResolvedValue(highScoreReview) },
      maxRounds: 1,
    }).execute(task);

    expect(highResult.rounds).toBe(1);
    expect(highResult.finalReview.passed).toBe(true);

    const lowScoreReview = reviewResult(70, true);
    const lowResult = await createExecutor({
      execute: vi.fn().mockResolvedValue(candidate("low-score")),
      reviewer: { review: vi.fn().mockResolvedValue(lowScoreReview) },
      maxRounds: 1,
    }).execute(task);

    expect(lowResult.finalReview.passed).toBe(false);
    expect(lowResult.qualityRisk?.code).toBe("quality_threshold_unmet");
  });

  it("passes prior issues and revision instructions into a later successful round", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce(candidate("draft"))
      .mockResolvedValueOnce(candidate("revised"));
    const firstReview = reviewResult(60);
    const review = vi.fn()
      .mockResolvedValueOnce(firstReview)
      .mockResolvedValueOnce(reviewResult(88, true));

    const result = await createExecutor({ execute, reviewer: { review } }).execute(task);

    expect(result).toMatchObject({ output: "revised", rounds: 2 });
    expect(result.qualityRisk).toBeUndefined();
    expect(execute).toHaveBeenNthCalledWith(2, expect.objectContaining({
      round: 2,
      revisionInstructions: firstReview.revisionInstructions,
      priorIssues: firstReview.issues,
    }));
  });

  it("returns the best scored candidate with a budget risk when budget is exhausted", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce(candidate("v1"))
      .mockResolvedValueOnce(candidate("v2"));
    const review = vi.fn()
      .mockResolvedValueOnce(reviewResult(80))
      .mockResolvedValueOnce(reviewResult(75));
    const hasBudget = vi.fn()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);

    const result = await createExecutor({ execute, reviewer: { review }, hasBudget }).execute(task);

    expect(result.output).toBe("v1");
    expect(result.rounds).toBe(2);
    expect(result.qualityRisk?.code).toBe("budget_exhausted");
  });

  it("throws when budget is exhausted before any candidate is scored", async () => {
    const events: ReflectionEvent[] = [];
    const execute = vi.fn();
    const review = vi.fn();
    const executor = createExecutor({ hasBudget: () => false, execute, reviewer: { review }, onEvent: (event) => events.push(event) });

    await expect(executor.execute(task)).rejects.toThrow(/before any candidate was reviewed/);
    expect(execute).not.toHaveBeenCalled();
    expect(review).not.toHaveBeenCalled();
    expect(events).toEqual([{ type: "reflection.started", maxRounds: 3 }]);
  });

  it("honors an AbortSignal before and between rounds", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    const before = createExecutor();
    await expect(before.execute(task, controller.signal)).rejects.toThrow("cancelled");

    const betweenController = new AbortController();
    const execute = vi.fn().mockResolvedValue(candidate("v1"));
    const review = vi.fn().mockImplementation(async () => {
      betweenController.abort(new Error("stop now"));
      return reviewResult(90, true);
    });
    const between = createExecutor({ execute, reviewer: { review } });

    await expect(between.execute(task, betweenController.signal)).rejects.toThrow("stop now");
    expect(execute).toHaveBeenCalledOnce();
  });

  it("actively rejects when an in-flight reviewer remains pending", async () => {
    const controller = new AbortController();
    const review = vi.fn(() => new Promise<ReviewResult>(() => {}));
    const executor = createExecutor({ reviewer: { review } });
    const pending = executor.execute(task, controller.signal);

    await vi.waitFor(() => expect(review).toHaveBeenCalledOnce());
    controller.abort(new Error("review cancelled"));

    await expect(pending).rejects.toThrow("review cancelled");
    expect(review).toHaveBeenCalledWith(expect.any(Object), controller.signal);
  });

  it("emits start, review, and final events in order", async () => {
    const events: ReflectionEvent[] = [];
    const executor = createExecutor({
      reviewer: { review: vi.fn().mockResolvedValue(reviewResult(90, true)) },
      onEvent: (event) => events.push(event),
    });

    await executor.execute(task);

    expect(events).toEqual([
      { type: "reflection.started", maxRounds: 3 },
      { type: "review.completed", round: 1, score: 90, passed: true },
      { type: "reflection.completed", rounds: 1, score: 90, passed: true },
    ]);
  });

  it("isolates event callback failures from execution", async () => {
    const eventFailure = new Error("observer unavailable");
    const onEventError = vi.fn();
    const executor = createExecutor({
      reviewer: { review: vi.fn().mockResolvedValue(reviewResult(90, false)) },
      onEvent: vi.fn(() => { throw eventFailure; }),
      onEventError,
    });

    await expect(executor.execute(task)).resolves.toMatchObject({ rounds: 1, finalReview: { passed: true } });
    expect(onEventError).toHaveBeenCalledTimes(3);
    expect(onEventError).toHaveBeenCalledWith(eventFailure);
  });

  it("emits only the start event when the first review fails", async () => {
    const failure = new Error("review unavailable");
    const events: ReflectionEvent[] = [];
    const executor = createExecutor({
      reviewer: { review: vi.fn().mockRejectedValue(failure) },
      onEvent: (event) => events.push(event),
    });

    await expect(executor.execute(task)).rejects.toBe(failure);
    expect(events).toEqual([{ type: "reflection.started", maxRounds: 3 }]);
  });

  it("rethrows reviewer failure without admitting the unscored candidate", async () => {
    const failure = new Error("review unavailable");
    const execute = vi.fn()
      .mockResolvedValueOnce(candidate("scored"))
      .mockResolvedValueOnce(candidate("unscored"));
    const review = vi.fn()
      .mockResolvedValueOnce(reviewResult(70))
      .mockRejectedValueOnce(failure);
    const events: ReflectionEvent[] = [];
    const executor = createExecutor({ execute, reviewer: { review }, onEvent: (event) => events.push(event) });

    await expect(executor.execute(task)).rejects.toBe(failure);
    expect(events.filter((event) => event.type === "review.completed")).toHaveLength(1);
    expect(events.some((event) => event.type === "reflection.completed")).toBe(false);
  });

  it.each([0, 4, 1.5])("rejects maxRounds %s outside the supported range", (maxRounds) => {
    expect(() => createExecutor({ maxRounds })).toThrow(/maxRounds/);
  });

  it.each([-1, 101, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid passThreshold %s", (passThreshold) => {
    expect(() => createExecutor({ passThreshold })).toThrow(/passThreshold/);
  });
});
