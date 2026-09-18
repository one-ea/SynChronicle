import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { detectAitone, type AitoneResult } from "../stylestat/aitone.js";

export interface RewriteOptions {
  style?: string;
  instructions?: string;
  reduceAitone?: boolean;
}

export interface RewritePromptPlan {
  styleName: string;
  styleGuide: string;
  negativeConstraints: string[];
  systemInstruction: string;
  userPrompt: string;
}

const KNOWN_STYLES = new Set(["default", "suspense", "fantasy", "romance"]);

export async function loadStyleGuide(styleName = "default"): Promise<string> {
  const normalized = KNOWN_STYLES.has(styleName.toLowerCase()) ? styleName.toLowerCase() : "default";
  try {
    const file = join("assets", "styles", `${normalized}.md`);
    return await readFile(file, "utf8");
  } catch {
    return "叙事节奏自然生动，感官描写充实具体，杜绝抽象概述与套路句式。";
  }
}

export function buildNegativeConstraints(aitone: AitoneResult | null): string[] {
  if (!aitone || !aitone.hits.length) return [];
  const rules: string[] = [];
  for (const hit of aitone.hits) {
    if (hit.count > 0) {
      rules.push(`严禁使用${hit.name}（如：${hit.samples.join("、")}），请改用具体动作描写或侧面感官展现。`);
    }
  }
  return rules;
}

export async function buildRewritePlan(
  originalText: string,
  chapter: number,
  options: RewriteOptions = {},
): Promise<RewritePromptPlan> {
  const styleName = options.style || "default";
  const styleGuide = await loadStyleGuide(styleName);
  const aitone = options.reduceAitone !== false ? detectAitone(originalText) : null;
  const negativeConstraints = buildNegativeConstraints(aitone);

  const systemInstruction = [
    `你是一位顶尖的小说重构与精修专家。现在需要对第 ${chapter} 章正文进行深度文风重构与润色。`,
    `【目标文风指南】\n${styleGuide}`,
    negativeConstraints.length ? `【负向去AI味红线】\n${negativeConstraints.map((c, i) => `${i + 1}. ${c}`).join("\n")}` : "",
    options.instructions ? `【特别润色要求】\n${options.instructions}` : "",
    "【修改纪律】保持原章节的情节主线、核心矛盾和出场角色不变，提升文学厚度、细节颗粒度与叙事吸引力，直接输出重写后的正文内容，无需输出额外解释。",
  ]
    .filter(Boolean)
    .join("\n\n");

  const userPrompt = `以下是第 ${chapter} 章原始正文：\n\n${originalText}\n\n请严格遵照上述文风与去AI味要求进行重新撰写：`;

  return {
    styleName,
    styleGuide,
    negativeConstraints,
    systemInstruction,
    userPrompt,
  };
}
