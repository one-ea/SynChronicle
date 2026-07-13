import type { AgentRole } from "./types.js";

interface RubricDimension {
  readonly name: string;
  readonly weight: number;
  readonly criteria: string;
}

export interface ReviewRubric {
  role: AgentRole;
  threshold: number;
  dimensions: ReadonlyArray<RubricDimension>;
}

const RUBRICS: Record<AgentRole, ReadonlyArray<RubricDimension>> = {
  architect: [
    { name: "结构完整性", weight: 30, criteria: "叙事结构覆盖必要阶段并支撑故事目标" },
    { name: "因果一致性", weight: 30, criteria: "事件因果链完整且不存在逻辑冲突" },
    { name: "角色与世界规则一致性", weight: 25, criteria: "角色设定与世界规则保持一致" },
    { name: "可执行性", weight: 15, criteria: "方案足够具体并可供后续创作直接执行" },
  ],
  writer: [
    { name: "任务遵循", weight: 20, criteria: "输出完整遵循写作任务与约束" },
    { name: "情节连贯", weight: 20, criteria: "场景推进自然并与既定情节保持一致" },
    { name: "角色一致性", weight: 20, criteria: "角色言行符合设定并体现明确动机" },
    { name: "文风质量", weight: 20, criteria: "语言流畅且符合目标叙事风格" },
    { name: "节奏与可读性", weight: 20, criteria: "叙事节奏清晰且文本易于阅读" },
  ],
  editor: [
    { name: "问题识别覆盖率", weight: 30, criteria: "识别影响质量的关键问题与风险" },
    { name: "证据准确性", weight: 25, criteria: "审查结论由输出中的具体证据支持" },
    { name: "建议可操作性", weight: 25, criteria: "修改建议具体且能够直接执行" },
    { name: "审阅结论一致性", weight: 20, criteria: "评分、问题和最终结论彼此一致" },
  ],
};

export function getReviewRubric(role: AgentRole, threshold = 85): ReviewRubric {
  return { role, threshold, dimensions: structuredClone(RUBRICS[role]) };
}
