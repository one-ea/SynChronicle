import { describe, expect, it, vi } from "vitest";
import { getReviewRubric } from "./rubrics.js";
import { Reviewer, ReviewerError, type ReviewRequest } from "./reviewer.js";

const model = { modelId: "reviewer-model" } as never;
const rubric = getReviewRubric("writer", 85);
const request: ReviewRequest = {
  objective: "Write a tense confrontation.",
  constraints: ["Keep the characters consistent."],
  candidate: "The candidate text.",
  rubric,
  priorIssues: [],
};

function validReview(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    score: 90,
    passed: false,
    summary: "Strong result.",
    issues: [],
    revisionInstructions: [],
    ...overrides,
  };
}

describe("Reviewer", () => {
  it("uses its model without tools and recomputes passed from score", async () => {
    const generate = vi.fn().mockResolvedValue({
      text: JSON.stringify(validReview()),
      usage: { inputTokens: 12, outputTokens: 8 },
    });
    const onUsage = vi.fn();
    const reviewer = new Reviewer({ model, generate, onUsage });

    const result = await reviewer.review(request);

    expect(result.passed).toBe(true);
    expect(generate).toHaveBeenCalledOnce();
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ model, prompt: expect.any(String) }));
    expect(generate.mock.calls[0]?.[0]).not.toHaveProperty("tools");
    expect(generate.mock.calls[0]?.[0].prompt).toContain(JSON.stringify(rubric));
    expect(onUsage).toHaveBeenCalledWith("reviewer", { inputTokens: 12, outputTokens: 8 });
  });

  it("forwards AbortSignal to generation while preserving signal-free calls", async () => {
    const controller = new AbortController();
    const generate = vi.fn().mockResolvedValue({ text: JSON.stringify(validReview()), usage: {} });
    const reviewer = new Reviewer({ model, generate });

    await reviewer.review(request, controller.signal);
    await reviewer.review(request);

    expect(generate).toHaveBeenNthCalledWith(1, expect.objectContaining({ abortSignal: controller.signal }));
    expect(generate.mock.calls[1]?.[0]).not.toHaveProperty("abortSignal");
  });

  it("retries invalid JSON and records usage for every completed generation", async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce({ text: "invalid", usage: { totalTokens: 3 } })
      .mockResolvedValueOnce({ text: JSON.stringify(validReview()), usage: { totalTokens: 7 } });
    const onUsage = vi.fn();
    const reviewer = new Reviewer({ model, generate, retryLimit: 2, onUsage });

    const result = await reviewer.review(request);

    expect(result.passed).toBe(true);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(onUsage).toHaveBeenNthCalledWith(1, "reviewer", { totalTokens: 3 });
    expect(onUsage).toHaveBeenNthCalledWith(2, "reviewer", { totalTokens: 7 });
  });

  it("retries output that fails the review schema", async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce({ text: JSON.stringify(validReview({ score: 101 })), usage: {} })
      .mockResolvedValueOnce({ text: JSON.stringify(validReview({ score: 84, passed: true })), usage: {} });
    const reviewer = new Reviewer({ model, generate, retryLimit: 1 });

    const result = await reviewer.review(request);

    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.passed).toBe(false);
  });

  it("throws ReviewerError after retry exhaustion", async () => {
    const generate = vi.fn().mockResolvedValue({ text: "invalid", usage: {} });
    const reviewer = new Reviewer({ model, generate, retryLimit: 1 });

    await expect(reviewer.review(request)).rejects.toBeInstanceOf(ReviewerError);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("does not retry or fail when usage reporting throws", async () => {
    const generate = vi.fn().mockResolvedValue({ text: JSON.stringify(validReview()), usage: { totalTokens: 9 } });
    const usageError = new Error("usage store unavailable");
    const onUsageError = vi.fn();
    const reviewer = new Reviewer({
      model,
      generate,
      onUsage: vi.fn(() => { throw usageError; }),
      onUsageError,
    });

    await expect(reviewer.review(request)).resolves.toMatchObject({ score: 90, passed: true });
    expect(generate).toHaveBeenCalledOnce();
    expect(onUsageError).toHaveBeenCalledWith(usageError);
  });

  it.each([-1, 4, 1.5, Number.NaN])("rejects invalid retryLimit %s", (retryLimit) => {
    expect(() => new Reviewer({ model, retryLimit })).toThrow(/retryLimit/);
  });

  it("keeps consecutive reviews independent", async () => {
    const generate = vi.fn().mockResolvedValue({ text: JSON.stringify(validReview()), usage: {} });
    const reviewer = new Reviewer({ model, generate });

    await reviewer.review({ ...request, candidate: "first candidate" });
    await reviewer.review({ ...request, candidate: "second candidate" });

    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[0]?.[0].prompt).toContain("first candidate");
    expect(generate.mock.calls[0]?.[0].prompt).not.toContain("second candidate");
    expect(generate.mock.calls[1]?.[0].prompt).toContain("second candidate");
    expect(generate.mock.calls[1]?.[0].prompt).not.toContain("first candidate");
  });
});
