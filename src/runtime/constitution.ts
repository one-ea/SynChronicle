import { isEmptyConstitution, type Constitution } from "../domain/constitution.js";

/**
 * 项目宪法渲染（specs/2026-09-19-p6-consistency-and-platform R1）。
 * 空宪法返回空串；非空输出 Markdown 块供生成提示词自动注入。
 */

export function renderConstitutionText(constitution: Constitution): string {
  if (isEmptyConstitution(constitution)) return "";
  const sections: string[] = ["[项目宪法] 以下为全书锁定规则，生成内容必须严格遵循："];
  if (constitution.worldRules.length) sections.push(`世界规则（不可违背）：\n${constitution.worldRules.map((rule) => `- ${rule}`).join("\n")}`);
  if (constitution.abilityCosts.length) sections.push(`能力代价（每次使用必须付出）：\n${constitution.abilityCosts.map((rule) => `- ${rule}`).join("\n")}`);
  if (constitution.forbiddenInfo.length) sections.push(`禁写信息（当前阶段禁止泄露）：\n${constitution.forbiddenInfo.map((rule) => `- ${rule}`).join("\n")}`);
  if (constitution.secretReveals.length) sections.push(`秘密揭晓计划：\n${constitution.secretReveals.map((item) => `- 「${item.secret}」计划于${item.revealAt}揭晓`).join("\n")}`);
  if (constitution.characterBoundaries.length) sections.push(`人物行为边界：\n${constitution.characterBoundaries.map((rule) => `- ${rule}`).join("\n")}`);
  return sections.join("\n\n");
}
