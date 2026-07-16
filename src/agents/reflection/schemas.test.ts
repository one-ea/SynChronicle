import { describe, expect, it } from "vitest";
import { parseReflectionExecutionState, ReflectionConfigSchema, ReviewResultSchema } from "./schemas.js";

const reviewResult = (score: number) => ({
  score,
  passed: false,
  summary: "ready",
  issues: [],
  revisionInstructions: [],
});

it("diagnoses unknown versions and extra fields in persisted execution state", () => {
  const base = { version: 1, executionId: "exec", status: "running", task: { objective: "write", constraints: [] }, nextRound: 1, candidates: [], revisionInstructions: [], priorIssues: [] };
  expect(() => parseReflectionExecutionState({ ...base, version: 2 })).toThrow(/schema\/version invalid/);
  expect(() => parseReflectionExecutionState({ ...base, unexpected: true })).toThrow(/schema\/version invalid/);
});

it("preserves reviewerAttempt in durable reflection state", () => {
  const state = { version: 1, executionId: "exec", status: "running", task: { objective: "write", constraints: [] }, nextRound: 2, candidates: [], revisionInstructions: [], priorIssues: [], reviewerAttempt: 2 };
  expect(parseReflectionExecutionState(state)).toMatchObject({ reviewerAttempt: 2 });
});

describe("reflection schemas", () => {
  it.each([0, 85, 100])("accepts review score %s", (score) => {
    expect(ReviewResultSchema.parse(reviewResult(score)).score).toBe(score);
  });

  it.each([-1, 101])("rejects review score %s", (score) => {
    expect(() => ReviewResultSchema.parse(reviewResult(score))).toThrow();
  });

  it("rejects unknown review fields", () => {
    expect(() => ReviewResultSchema.parse({ ...reviewResult(85), unknown: true })).toThrow();
  });

  it.each([
    { max_rounds: 0 },
    { max_rounds: 1.5 },
    { max_rounds: 4 },
    { pass_threshold: -1 },
    { pass_threshold: 101 },
    { review_retry_limit: -1 },
    { review_retry_limit: 4 },
    { reviewer_model: "" },
  ])("rejects invalid reflection config $%s", (config) => {
    expect(() => ReflectionConfigSchema.parse(config)).toThrow();
  });
});
