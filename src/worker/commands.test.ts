import { describe, expect, it } from "vitest";
import { taskError, taskPrompt } from "./commands.js";

describe("worker error classification", () => {
  it.each([
    [Object.assign(new Error("provider unavailable"), { status: 503 }), "transient", true],
    [Object.assign(new Error("serialization failure"), { code: "40001" }), "transient", true],
    [new Error("invalid task payload"), "invalid_input", false],
    [new Error("missing API key config"), "invalid_config", false],
    [new Error("lease ownership lost"), "lease_loss", false],
    [new Error("worker shutdown"), "cancel", false],
    [new Error("unexpected invariant"), "internal", false],
  ] as const)("classifies %s", (error, category, retryable) => {
    expect(taskError(error, 1, 3)).toMatchObject({ category, retryable });
  });

  it("stops retrying transient errors at the attempt limit", () => {
    expect(taskError(new Error("provider timeout"), 3, 3)).toMatchObject({ category: "transient", retryable: false });
  });

  it("classifies invalid task input at the source", () => {
    expect(() => taskPrompt({})).toThrow(expect.objectContaining({ category: "invalid_input", retryable: false }));
  });
});
