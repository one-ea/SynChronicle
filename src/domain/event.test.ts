import { describe, expect, it } from "vitest";
import { RuntimeEventSchema } from "./event.js";

describe("RuntimeEventSchema", () => {
  it("strictly validates reflection payloads by phase", () => {
    expect(RuntimeEventSchema.safeParse({ type: "reflection", message: "review.completed", payload: { phase: "review_completed", round: 2, score: 90, passed: true } }).success).toBe(true);
    expect(RuntimeEventSchema.safeParse({ type: "reflection", message: "review.completed", payload: { phase: "review_completed", round: 2, passed: true } }).success).toBe(false);
    expect(RuntimeEventSchema.safeParse({ type: "reflection", message: "review.completed", payload: { phase: "unknown", round: 2, score: 90, passed: true } }).success).toBe(false);
    expect(RuntimeEventSchema.safeParse({ type: "reflection", message: "review.completed", payload: { phase: "review_completed", round: 2, score: 90, passed: true, extra: true } }).success).toBe(false);
  });

  it("keeps non-reflection runtime events compatible", () => {
    expect(RuntimeEventSchema.safeParse({ type: "system", message: "ready", payload: { level: "info" } }).success).toBe(true);
  });
});
