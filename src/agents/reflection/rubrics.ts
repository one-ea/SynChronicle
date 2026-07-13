import type { AgentRole } from "./types.js";

interface RubricDimension {
  name: string;
  weight: number;
  criteria: string;
}

export interface ReviewRubric {
  role: AgentRole;
  threshold: number;
  dimensions: ReadonlyArray<RubricDimension>;
}

const RUBRICS: Record<AgentRole, ReadonlyArray<RubricDimension>> = {
  architect: [
    { name: "因果一致性", weight: 40, criteria: "事件因果链完整且不存在逻辑冲突" },
    { name: "结构完整性", weight: 35, criteria: "叙事结构覆盖必要阶段并支撑故事目标" },
    { name: "角色弧线", weight: 25, criteria: "角色动机与成长轨迹清晰且可信" },
  ],
  writer: [
    { name: "情节连贯", weight: 40, criteria: "场景推进自然并与既定情节保持一致" },
    { name: "角色表现", weight: 35, criteria: "角色言行符合设定并体现明确动机" },
    { name: "文风质量", weight: 25, criteria: "语言流畅且符合目标叙事风格" },
  ],
  editor: [
    { name: "证据准确性", weight: 40, criteria: "审查结论由输出中的具体证据支持" },
    { name: "问题覆盖", weight: 35, criteria: "识别影响质量的关键问题与风险" },
    { name: "建议可执行性", weight: 25, criteria: "修改建议具体且能够直接执行" },
  ],
};

export function getReviewRubric(role: AgentRole, threshold = 85): ReviewRubric {
  return { role, threshold, dimensions: structuredClone(RUBRICS[role]) };
}
