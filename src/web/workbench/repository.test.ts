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

  it("aggregates usage records by Agent and run totals", () => {
    expect(projectUsage([
      { agent: "Reviewer", inputTokens: "4", outputTokens: "2", cost: "0.003" },
      { agent: "Writer", inputTokens: "10", outputTokens: "5", cost: "0.010" },
    ])).toEqual({
      inputTokens: 14, outputTokens: 7, totalTokens: 21, cost: "0.01300000",
      byAgent: [
        { agent: "Reviewer", inputTokens: 4, outputTokens: 2, totalTokens: 6, cost: "0.00300000" },
        { agent: "Writer", inputTokens: 10, outputTokens: 5, totalTokens: 15, cost: "0.01000000" },
      ],
    });
  });
});
