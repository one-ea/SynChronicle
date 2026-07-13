import { describe, expect, it } from "vitest";
import { ReflectionConfigSchema, ReviewResultSchema } from "./schemas.js";

const reviewResult = (score: number) => ({
  score,
  passed: false,
  summary: "ready",
  issues: [],
  revisionInstructions: [],
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
