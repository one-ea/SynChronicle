import { readFile } from "node:fs/promises";

export interface ImportedChapter { chapter: number; title: string; content: string }

const ARABIC = "[0-9]+";
const CHINESE = "[零〇一二三四五六七八九十百千万两]+";
const MARKER = new RegExp(`^(?:#{1,3}\\s*)?(?:第\\s*(${ARABIC}|${CHINESE})\\s*[章节回卷部篇]|chapter\\s+(${ARABIC}))[ \\t]*([^\\n]*)$`, "gim");

export async function importTextFile(path: string): Promise<ImportedChapter[]> {
  const text = (await readFile(path, "utf8")).replace(/^\uFEFF/, "");
  return splitChapters(text);
}

/** 纯文本 → 章节切分（拆书/导入共用，specs/2026-09-19-p4-competitive-parity R3）。 */
export function splitChapters(rawText: string): ImportedChapter[] {
  const text = rawText.replace(/^\uFEFF/, "");
  const matches = [...text.matchAll(MARKER)];
  if (!matches.length) {
    const content = text.trim();
    return content ? [{ chapter: 1, title: "第 1 章", content }] : [];
  }

  const chapters: ImportedChapter[] = [];
  let previous = 0;
  for (const [index, match] of matches.entries()) {
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? text.length;
    const content = text.slice(start, end).trim();
    if (!content) continue;

    const number = parseChapterNumber(match[1] ?? match[2]);
    if (number === null) throw new Error(`无法解析章节编号: ${match[1] ?? match[2]}`);
    if (number <= previous) throw new Error(`导入章节编号必须严格递增：${previous} 后出现 ${number}`);
    previous = number;
    chapters.push({ chapter: number, title: formatTitle(match[0]), content });
  }
  return chapters;
}

function parseChapterNumber(value: string | undefined): number | null {
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number(value);
  const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (value.length === 1 && digits[value] !== undefined) return digits[value];
  const units: Array<[string, number]> = [["万", 10_000], ["千", 1_000], ["百", 100], ["十", 10]];
  let total = 0;
  let section = 0;
  let digit = 0;
  for (const char of value) {
    if (digits[char] !== undefined) digit = digits[char]!;
    else {
      const unit = units.find(([name]) => name === char)?.[1];
      if (!unit) return null;
      section += (digit || 1) * unit;
      digit = 0;
      if (unit >= 10_000) { total += section; section = 0; }
    }
  }
  return total + section + digit;
}

function formatTitle(marker: string): string {
  return marker.replace(/^#+\s*/, "").trim();
}
