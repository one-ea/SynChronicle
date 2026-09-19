import type { Lesson } from "../domain/evolution.js";
import type { Store } from "../store/index.js";

const TEMPLATES: Record<string, string> = {
  "structural completeness": "确保每章目标、阻碍、转折和结果完整闭环",
  "causal consistency": "每个转折前补足可见因果链，避免事件凭空发生",
  "character-world rule consistency": "人物选择必须符合既定动机与世界规则",
  executability: "把抽象规划落成可拍摄的场景动作与明确交付",
  "task adherence": "逐项核对本章任务，正文必须兑现核心事件与钩子",
  "plot coherence": "场景之间用目标变化连接，保持主线连续",
  "character consistency": "对话、行动和决策保持人物既定性格",
  "style quality": "避免成段心理直述，情绪用动作与物件外化",
  "pacing and readability": "每 800 字内安排一次张力拍，控制连续说明段",
  "issue identification coverage": "审稿覆盖结构、人物、节奏、语言与设定",
  "evidence accuracy": "每条审稿问题引用正文中的具体证据",
  "recommendation actionability": "建议写成可直接执行的改写动作",
  "review conclusion consistency": "结论必须与各维度评分和问题严重度一致",
};

export class EvolutionEngine {
  constructor(private readonly store: Store) {}
  async recordChapter(input: { chapter: number; golden: number; aitone: number; rewrites: number; reflectionIssues: Array<{ dimension: string; evidence: string }> }): Promise<void> { const file = await this.store.evolution.load(); const entry = { chapter: input.chapter, golden: input.golden, aitone: input.aitone, rewrites: input.rewrites, reflectionIssues: input.reflectionIssues.map((issue) => `${issue.dimension}|${issue.evidence}`) }; await this.store.evolution.save({ ...file, chapterScores: [...file.chapterScores.filter((item) => item.chapter !== input.chapter), entry].sort((a, b) => a.chapter - b.chapter).slice(-50) }); }
  async distill(): Promise<Lesson[]> { const file = await this.store.evolution.load(); const recent = file.chapterScores.slice(-10); const grouped = new Map<string, Array<{ chapter: number; evidence: string }>>(); for (const item of recent) for (const issue of item.reflectionIssues) { const [dimension, ...rest] = issue.split("|"); if (!dimension) continue; const list = grouped.get(dimension) ?? []; list.push({ chapter: item.chapter, evidence: rest.join("|") }); grouped.set(dimension, list); } const lessons = [...file.lessons]; const changed: Lesson[] = []; for (const [dimension, evidence] of grouped) { const chapters = [...new Set(evidence.map((item) => item.chapter))]; if (chapters.length < 2) continue; const existing = lessons.find((item) => item.dimension === dimension && item.status === "active"); if (existing) { existing.evidenceChapters = [...new Set([...existing.evidenceChapters, ...chapters])]; changed.push(existing); continue; } const lesson: Lesson = { id: `ls-${lessons.length + 1}`, dimension, pattern: (evidence[0]?.evidence || dimension).slice(0, 60), lesson: (TEMPLATES[dimension] || `针对 ${dimension} 逐段检查并修正`).slice(0, 120), evidenceChapters: chapters, bornAt: new Date().toISOString(), useCount: 0, scoreDeltas: [], status: "active", retiredAt: null, retireReason: "" }; lessons.push(lesson); changed.push(lesson); } await this.store.evolution.save({ ...file, lessons: capLessons(lessons) }); return changed; }
  async renderBlock(): Promise<string> { const file = await this.store.evolution.load(); const active = file.lessons.filter((item) => item.status === "active").slice(0, 20); if (!active.length) return ""; for (const lesson of active) lesson.useCount += 1; await this.store.evolution.save(file); return `[进化经验]\n${active.map((item) => `- (${item.dimension}) ${item.lesson}`).join("\n")}`; }
  async feedback(_chapter: number, score: number): Promise<void> { const file = await this.store.evolution.load(); const previous = file.chapterScores.at(-2)?.golden ?? file.chapterScores.at(-1)?.golden ?? score; const delta = score - previous; for (const lesson of file.lessons.filter((item) => item.status === "active" && item.useCount > item.scoreDeltas.length)) { lesson.scoreDeltas.push(delta); if (lesson.useCount >= 5 && mean(lesson.scoreDeltas) < 1) retire(lesson, "无效经验"); } await this.store.evolution.save({ ...file, lessons: capLessons(file.lessons) }); }
}
function mean(values: number[]) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function retire(lesson: Lesson, reason: string) { lesson.status = "retired"; lesson.retiredAt = new Date().toISOString(); lesson.retireReason = reason; }
function capLessons(lessons: Lesson[]): Lesson[] { const active = lessons.filter((item) => item.status === "active"); if (active.length > 20) for (const lesson of active.sort((a, b) => mean(a.scoreDeltas) - mean(b.scoreDeltas)).slice(0, active.length - 20)) retire(lesson, "超过 active 上限"); return lessons; }
