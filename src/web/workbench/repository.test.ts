import { describe, expect, it } from "vitest";
import { projectAgents, projectUsage } from "./repository.js";

describe("workbench projections", () => {
  it("projects Agent states from runtime events, tasks, and checkpoints without guesses", () => {
    const agents = projectAgents(
      [{ sequence: 9, type: "system", payload: { type: "system", agent: "Writer", message: "drafting" } }],
      { type: "write", status: "running" },
      { agents: [{ name: "Reviewer", state: "waiting", summary: "awaiting draft" }] },
    );
    expect(agents).toEqual([
      { name: "Writer", state: "system", summary: "drafting", sequence: 9 },
      { name: "Reviewer", state: "waiting", summary: "awaiting draft" },
    ]);
  });

  it("uses only the latest cumulative snapshot per usage dimension", () => {
    expect(projectUsage([
      { snapshotId: "review-1", agent: "Reviewer", credentialSource: "user", provider: "openai", model: "review", inputTokens: "4", outputTokens: "2", cost: "0.003", createdAt: new Date(1) },
      { snapshotId: "writer-old", agent: "Writer", credentialSource: "user", provider: "openai", model: "gpt", inputTokens: "10", outputTokens: "5", cost: "0.010", createdAt: new Date(1) },
      { snapshotId: "writer-new", agent: "Writer", credentialSource: "user", provider: "openai", model: "gpt", inputTokens: "25", outputTokens: "9", cost: "0.020", createdAt: new Date(2) },
    ])).toEqual({
      inputTokens: 29, outputTokens: 11, totalTokens: 40, cost: "0.02300000",
      byAgent: [
        { agent: "Reviewer", inputTokens: 4, outputTokens: 2, totalTokens: 6, cost: "0.00300000" },
        { agent: "Writer", inputTokens: 25, outputTokens: 9, totalTokens: 34, cost: "0.02000000" },
      ],
    });
  });

  it("prefers the latest real usage state per_agent structure", () => {
    const state = { overall: { input: 30, output: 12, cost_usd: 0.04 }, per_agent: { Writer: { input: 20, output: 7, cost_usd: 0.03 }, Reviewer: { input: 10, output: 5, cost_usd: 0.01 } } };
    expect(projectUsage([{ snapshotId: "state-2", agent: "__store_state__", credentialSource: "store", provider: "store", model: "aggregate", inputTokens: 30, outputTokens: 12, cost: "0.04", createdAt: new Date(2), state }])).toEqual({ inputTokens: 30, outputTokens: 12, totalTokens: 42, cost: "0.04000000", byAgent: [{ agent: "Reviewer", inputTokens: 10, outputTokens: 5, totalTokens: 15, cost: "0.01000000" }, { agent: "Writer", inputTokens: 20, outputTokens: 7, totalTokens: 27, cost: "0.03000000" }] });
  });
});
