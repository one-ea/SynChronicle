import { describe, expect, it } from "vitest";
import { getReviewRubric } from "./rubrics.js";

describe("getReviewRubric", () => {
  it.each([
    ["architect", ["结构完整性", "因果一致性", "角色与世界规则一致性", "可执行性"]],
    ["writer", ["任务遵循", "情节连贯", "角色一致性", "文风质量", "节奏与可读性"]],
    ["editor", ["问题识别覆盖率", "证据准确性", "建议可操作性", "审阅结论一致性"]],
  ] as const)("returns the complete %s rubric", (role, dimensions) => {
    const rubric = getReviewRubric(role, 90);

    expect(rubric.role).toBe(role);
    expect(rubric.threshold).toBe(90);
    expect(rubric.dimensions.map((item) => item.name)).toEqual(dimensions);
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
