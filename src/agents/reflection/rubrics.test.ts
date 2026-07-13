import { describe, expect, it } from "vitest";
import { getReviewRubric } from "./rubrics.js";

describe("getReviewRubric", () => {
  it.each([
    ["architect", "因果一致性"],
    ["writer", "情节连贯"],
    ["editor", "证据准确性"],
  ] as const)("returns the %s rubric", (role, dimension) => {
    const rubric = getReviewRubric(role, 90);

    expect(rubric.role).toBe(role);
    expect(rubric.threshold).toBe(90);
    expect(rubric.dimensions.map((item) => item.name)).toContain(dimension);
    expect(rubric.dimensions.reduce((sum, item) => sum + item.weight, 0)).toBe(100);
  });

  it("uses the default threshold", () => {
    expect(getReviewRubric("architect").threshold).toBe(85);
  });

  it("returns independent dimension copies", () => {
    const first = getReviewRubric("writer");
    const second = getReviewRubric("writer");

    expect(first.dimensions).not.toBe(second.dimensions);
    expect(first.dimensions[0]).not.toBe(second.dimensions[0]);
  });
});
