/**
 * 读者模拟与对抗评审（specs/2026-09-19-p4-competitive-parity R2）。
 * 启发式四维读者分（爽点密度/章末钩子/节奏方差/对话密度）
 * 与四攻击角度对抗评审（平淡/注水/AI味/实体漂移）。零模型依赖，只读。
 */

const THRILL_WORDS = ["杀", "怒", "血", "战", "胜", "赢", "翻盘", "爆发", "震惊", "威胁", "背叛", "复仇", "危机", "生死", "轰", "撕裂", "狂", "碾压", "反杀", "底牌"];
const HOOK_MARKS = ["？", "?", "突然", "然而", "却见", "竟", "赫然", "下一刻", "就在这时", "未完"];

export interface ReaderDimensions { thrill: number; hook: number; rhythm: number; dialogue: number }
export interface ReaderScore { score: number; dimensions: ReaderDimensions }

function clamp(value: number): number { return Math.max(0, Math.min(100, Math.round(value))); }

/** 统计每千字爽点词命中数。 */
export function thrillDensity(text: string): number {
  const chars = [...text.replace(/\s/g, "")].length;
  if (!chars) return 0;
  let hits = 0;
  for (const word of THRILL_WORDS) hits += Math.max(0, text.split(word).length - 1);
  return (hits * 1000) / chars;
}

/** 章末钩子：末段悬念标记计数（0-100）。 */
export function hookScore(text: string): number {
  const paragraphs = text.trim().split(/\n{1,}/).filter(Boolean);
  const tail = paragraphs.slice(-2).join(" ");
  if (!tail) return 0;
  let marks = 0;
  for (const mark of HOOK_MARKS) if (tail.includes(mark)) marks += 1;
  return clamp(marks * 22);
}

/** 节奏方差：句长标准差归一（0-100）。 */
export function rhythmScore(text: string): number {
  const sentences = text.split(/[。！？!?;\n]+/).map((item) => item.trim()).filter((item) => item.length > 1);
  if (sentences.length < 3) return 0;
  const lengths = sentences.map((item) => [...item].length);
  const mean = lengths.reduce((total, value) => total + value, 0) / lengths.length;
  const variance = lengths.reduce((total, value) => total + (value - mean) ** 2, 0) / lengths.length;
  return clamp(Math.sqrt(variance) * 6);
}

/** 对话密度：引号内字符占比（0-100）。 */
export function dialogueScore(text: string): number {
  const chars = [...text.replace(/\s/g, "")].length;
  if (!chars) return 0;
  const quoted = text.match(/[“"][^”"]{2,}[”"]/g)?.join("") ?? "";
  return clamp(([...quoted.replace(/\s/g, "")].length / chars) * 220);
}

export function readerScore(text: string): ReaderScore | null {
  if (!text.trim()) return null;
  const thrill = clamp(thrillDensity(text) * 10);
  const dimensions: ReaderDimensions = { thrill, hook: hookScore(text), rhythm: rhythmScore(text), dialogue: dialogueScore(text) };
  const score = clamp(dimensions.thrill * 0.35 + dimensions.hook * 0.3 + dimensions.rhythm * 0.2 + dimensions.dialogue * 0.15);
  return { score, dimensions };
}

export interface ReviewChapterInput { chapter: number; title: string; text: string; aitoneScore?: number }
export interface ReviewFinding { attack: "flat" | "padding" | "aitone" | "entityDrift"; chapter?: number; evidence: string; severity: "warning" | "info" }
export interface ReviewReport { chapters: Array<{ chapter: number; title: string; score: number; dimensions: ReaderDimensions }>; findings: ReviewFinding[]; averageScore: number }

/** 常见中文姓氏启发（用于实体漂移粗筛）。 */
const SURNAMES = ["沈", "苏", "顾", "林", "陆", "秦", "江", "叶", "楚", "萧", "宋", "赵", "钱", "孙", "李", "周", "吴", "郑", "王", "冯", "陈", "楮", "卫", "蒋", "沈", "韩", "杨"];
const DRIFT_STOP = new Set(["他们", "她说", "他说", "那人", "众人", "少年", "老人", "女子", "男子"]);

/** 从正文提取候选人名（姓氏 + 1~2 字名），过滤停用词，同姓优先取更长且高频的候选。 */
export function extractNameCandidates(text: string): string[] {
  const counts = new Map<string, number>();
  const cjk = /[\u4e00-\u9fff]/;
  for (const surname of new Set(SURNAMES)) {
    let index = text.indexOf(surname);
    while (index !== -1) {
      const next1 = text[index + 1];
      const next2 = text[index + 2];
      if (next1 && cjk.test(next1)) {
        if (next2 && cjk.test(next2)) {
          const three = surname + next1 + next2;
          counts.set(three, (counts.get(three) ?? 0) + 1);
        }
        const two = surname + next1;
        counts.set(two, (counts.get(two) ?? 0) + 1);
      }
      index = text.indexOf(surname, index + 1);
    }
  }
  const qualified = [...counts.entries()].filter(([name, count]) => count >= 3 && !DRIFT_STOP.has(name));
  const best = new Map<string, { name: string; count: number }>();
  for (const [name, count] of qualified) {
    const surname = name[0]!;
    const current = best.get(surname);
    if (!current || count > current.count || (count === current.count && name.length > current.name.length)) best.set(surname, { name, count });
  }
  return [...best.values()].map((item) => item.name).sort();
}

export function adversarialReview(chapters: ReviewChapterInput[], registeredNames: string[]): ReviewReport {
  const scored = chapters
    .map((item) => ({ input: item, result: readerScore(item.text) }))
    .filter((item): item is { input: ReviewChapterInput; result: ReaderScore } => item.result !== null);
  if (!scored.length) return { chapters: [], findings: [], averageScore: 0 };

  const rows = scored.map((item) => ({ chapter: item.input.chapter, title: item.input.title, score: item.result.score, dimensions: item.result.dimensions }));
  const averageScore = Math.round(rows.reduce((total, row) => total + row.score, 0) / rows.length);
  const words = scored.map((item) => [...item.input.text.replace(/\s/g, "")].length);
  const avgWords = words.reduce((total, value) => total + value, 0) / words.length || 1;
  const avgThrill = rows.reduce((total, row) => total + row.dimensions.thrill, 0) / rows.length || 1;

  const findings: ReviewFinding[] = [];
  let flatRun = 0;
  for (const row of rows) {
    if (row.score < 55) {
      flatRun += 1;
      if (flatRun >= 2) findings.push({ attack: "flat", chapter: row.chapter, evidence: `连续 ${flatRun} 章读者分低于 55（当前 ${row.score}），存在平淡风险`, severity: "warning" });
    } else flatRun = 0;
    const index = rows.indexOf(row);
    if (words[index]! > avgWords * 1.3 && row.dimensions.thrill < avgThrill * 0.6) {
      findings.push({ attack: "padding", chapter: row.chapter, evidence: `字数 ${words[index]!} 超均值 30% 且爽点密度仅为均值 ${Math.round((row.dimensions.thrill / avgThrill) * 100)}%，疑似注水`, severity: "warning" });
    }
    const aitone = scored[index]!.input.aitoneScore;
    if (aitone !== undefined && aitone < 70) findings.push({ attack: "aitone", chapter: row.chapter, evidence: `AI 味得分 ${aitone} 低于 70，建议执行文风重写`, severity: "warning" });
  }

  const known = new Set(registeredNames.flatMap((name) => [name, ...name.split("")]).map((item) => item));
  const driftNames = new Map<string, number>();
  for (const item of scored) for (const name of extractNameCandidates(item.input.text)) {
    if (registeredNames.includes(name)) continue;
    driftNames.set(name, (driftNames.get(name) ?? 0) + 1);
  }
  for (const [name, count] of driftNames) {
    // extractNameCandidates 已要求单章内 ≥3 次提及，跨章出现即足以提示
    if (count >= 1 && !known.has(name)) findings.push({ attack: "entityDrift", evidence: `人名「${name}」在 ${count} 章正文高频出现但未注册实体图谱，存在设定漂移风险`, severity: "info" });
  }

  return { chapters: rows, findings, averageScore };
}
