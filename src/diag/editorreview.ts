import type { Store } from "../store/index.js";
import { goldenReviewFromStore, type GoldenReport } from "./golden.js";

/**
 * 编辑视角审稿（specs/2026-09-19-p5-creation-workbench R5）。
 * 过稿风险清单：题材撞车/卖点模糊/人设单薄/视角混乱。三档投稿建议。只读。
 */

const TROPE_WORDS = ["穿越", "重生", "退婚", "赘婿", "系统", "开局", "签到", "神豪", "战神归来", "真假千金"];
const SELLING_WORDS = ["逆袭", "复仇", "崛起", "翻盘", "扮猪吃虎", "一雪前耻", "打脸", "杀回"];

export interface EditorRisk { check: string; evidence: string }
export interface EditorReport { risks: EditorRisk[]; verdict: "可投稿" | "修改后投稿" | "建议大改"; golden: GoldenReport }

export async function editorReview(store: Store): Promise<EditorReport> {
  const risks: EditorRisk[] = [];

  const premise = await store.outline.loadPremise();
  const premiseText = typeof premise === "string" ? premise : JSON.stringify(premise ?? "");
  const hitTrope = TROPE_WORDS.filter((word) => premiseText.includes(word));
  if (hitTrope.length) risks.push({ check: "题材撞车", evidence: `premise 命中常见套路词：${hitTrope.join("、")}` });
  if (premiseText.trim() && !SELLING_WORDS.some((word) => premiseText.includes(word))) {
    risks.push({ check: "卖点模糊", evidence: "premise 未包含核心爽点要素（逆袭/复仇/崛起等）" });
  }

  const entities = await store.entities.load();
  const thin = entities.entities.filter((entity) => entity.type === "character" && (!entity.description.trim() || entity.states.length === 0));
  if (thin.length) risks.push({ check: "人设单薄", evidence: `${thin.length} 位角色缺少描述或状态记录：${thin.map((entity) => entity.name).slice(0, 4).join("、")}` });

  const progress = await store.progress.load();
  const earlyChapters: Array<{ chapter: number; text: string }> = [];
  for (const chapter of [...(progress?.completed_chapters ?? [])].filter((item) => item <= 3).sort((a, b) => a - b)) {
    const text = await store.drafts.loadChapterText(chapter);
    if (text) earlyChapters.push({ chapter, text });
  }
  let hasFirst = false;
  let hasThird = false;
  for (const item of earlyChapters) {
    if (/(^|[^“”\n])我[们们]?/.test(item.text)) hasFirst = true;
    const third = item.text.match(/[沈苏顾林陆秦江叶楚萧宋裴][\u4e00-\u9fff]{1,2}(说|看|走|抬|笑|问)/g);
    if (third?.length) hasThird = true;
  }
  if (hasFirst && hasThird) risks.push({ check: "视角混乱", evidence: "前三章同时出现第一人称叙述与第三人称主语动作，建议统一叙事视角" });

  const golden = await goldenReviewFromStore(store);
  if (golden.averageScore > 0 && golden.averageScore < 50) risks.push({ check: "开篇缓慢", evidence: `黄金三章综合分 ${golden.averageScore}，开局吸引力不足` });

  const verdict: EditorReport["verdict"] = risks.length === 0 ? "可投稿" : risks.length <= 2 ? "修改后投稿" : "建议大改";
  return { risks, verdict, golden };
}
