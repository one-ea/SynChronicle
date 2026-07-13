import { describe, expect, it } from "vitest";
import { ReviewResultSchema } from "./schemas.js";

describe("reflection schemas", () => {
  it("validates review scores", () => {
    expect(ReviewResultSchema.parse({
      score: 85,
      passed: false,
      summary: "ready",
      issues: [],
      revisionInstructions: [],
    }).score).toBe(85);

    expect(() => ReviewResultSchema.parse({
      score: 101,
      passed: false,
      summary: "too high",
      issues: [],
      revisionInstructions: [],
    })).toThrow();
  });
});
