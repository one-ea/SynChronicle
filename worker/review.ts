/**
 * P11-C8 边缘 Editor：章末摘要自动化与弧级质量评审。
 */

export const SUMMARY_SYSTEM_PROMPT = "你是小说记录员。把给定章节压缩为 120 字以内的摘要：保留关键事件、人物变化与悬念，不评论不扩展。只输出摘要正文。";

export const REVIEW_SYSTEM_PROMPT = "你是长篇小说编辑。基于前提与各章摘要做弧级评审，只输出 JSON：{\"score\": 0-100 整数, \"verdict\": \"一句话总评\", \"issues\": [{\"chapter\": 章号, \"severity\": \"low|medium|high\", \"note\": \"问题\"}], \"suggestions\": [\"建议\"]}。issues 最多 5 条，suggestions 最多 3 条。";

/** 容错提取模型输出中的 JSON 对象（容忍 markdown 围栏与前后缀文本）。 */
export function parseJsonBlock(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(cleaned.slice(start, end + 1));
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}

export interface EdgeReviewReport {
  id: string;
  chapters: number[];
  score: number | null;
  verdict: string;
  issues: Array<{ chapter: number; severity: string; note: string }>;
  suggestions: string[];
  createdAt: string;
  usage: { input: number; output: number };
}

/** 归一化模型 JSON 为评审报告；解析失败时降级为纯文本 verdict。 */
export function normalizeReport(raw: string, chapters: number[], usage: { input: number; output: number }, now: string): EdgeReviewReport {
  const parsed = parseJsonBlock(raw);
  const id = `arc-${now.replace(/[-:TZ.]/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`;
  if (!parsed) {
    return { id, chapters, score: null, verdict: raw.trim().slice(0, 500), issues: [], suggestions: [], createdAt: now, usage };
  }
  const issues = Array.isArray(parsed.issues)
    ? (parsed.issues as Array<Record<string, unknown>>).slice(0, 5).map((item) => ({
      chapter: Number(item.chapter ?? 0) || 0,
      severity: typeof item.severity === "string" ? item.severity : "medium",
      note: typeof item.note === "string" ? item.note : "",
    }))
    : [];
  const suggestions = Array.isArray(parsed.suggestions)
    ? (parsed.suggestions as unknown[]).slice(0, 3).map((item) => String(item))
    : [];
  return {
    id,
    chapters,
    score: typeof parsed.score === "number" ? Math.max(0, Math.min(100, Math.round(parsed.score))) : null,
    verdict: typeof parsed.verdict === "string" ? parsed.verdict : "",
    issues,
    suggestions,
    createdAt: now,
    usage,
  };
}
