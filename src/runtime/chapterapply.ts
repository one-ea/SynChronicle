import type { Store } from "../store/index.js";
import { countWords } from "../store/versions.js";

/**
 * 章节正文落盘共用路径（P7 引入，P8 起 server 与 autopilot runner 共享）：
 * 保存终稿 + 更新进度字数 + 版本快照归档。
 */

export async function applyChapterText(store: Store, chapter: number, text: string, source: string): Promise<{ wordCount: number }> {
  await store.drafts.saveFinalChapter(chapter, text);
  await store.versions.record(chapter, text, source).catch(() => undefined);
  // 统一去空白口径（对齐 importText/versions），避免 autopilot 路径字数系统性虚高
  const words = countWords(text);
  const progress = await store.progress.load();
  if (progress) {
    const counts = { ...(progress.chapter_word_counts || {}) };
    const oldWords = counts[String(chapter)] ?? 0;
    counts[String(chapter)] = words;
    const totalWords = Math.max(0, (progress.total_word_count || 0) - oldWords + words);
    const completed = new Set(progress.completed_chapters || []);
    completed.add(chapter);
    await store.progress.save({ ...progress, chapter_word_counts: counts, total_word_count: totalWords, completed_chapters: [...completed].sort((a, b) => a - b) });
  }
  return { wordCount: words };
}
