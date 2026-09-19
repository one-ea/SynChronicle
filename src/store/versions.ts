import { z } from "zod";
import { FileIO } from "./io.js";

/**
 * 章节版本时光机（P7-2）。
 * 每次正文落盘（提交/采纳/重写/手工编辑/恢复）记录一份快照，
 * 每章最多保留 30 份，连续相同内容自动去重。
 */

const ChapterVersionSchema = z.object({
  id: z.number().int().positive(),
  ts: z.string().min(1),
  source: z.string().min(1).max(30),
  words: z.number().int().nonnegative(),
  text: z.string(),
});
export type ChapterVersion = z.infer<typeof ChapterVersionSchema>;

const VersionFileSchema = z.object({ versions: z.array(ChapterVersionSchema).default([]) });
type VersionFile = z.infer<typeof VersionFileSchema>;

const MAX_VERSIONS_PER_CHAPTER = 30;

export const VERSION_SOURCES = {
  commit: "生成提交",
  adopt: "竞写采纳",
  studio: "写作台编辑",
  restore: "时光机恢复前备份",
  import: "本地导入",
  branch: "分支检出",
} as const;

function filePath(chapter: number): string {
  return `versions/chapter-${String(chapter).padStart(3, "0")}.json`;
}

export function countWords(text: string): number {
  return [...text.replace(/\s/g, "")].length;
}

export class VersionStore {
  constructor(private readonly io: FileIO) {}

  async list(chapter: number): Promise<ChapterVersion[]> {
    const file = await this.load(chapter);
    return [...file.versions].sort((a, b) => b.id - a.id);
  }

  async get(chapter: number, id: number): Promise<ChapterVersion | null> {
    const file = await this.load(chapter);
    return file.versions.find((version) => version.id === id) ?? null;
  }

  /** 记录一份快照；与最新快照内容相同则跳过，返回是否写入。 */
  async record(chapter: number, text: string, source: string): Promise<boolean> {
    if (chapter <= 0) throw new Error("chapter must be > 0");
    if (!text.trim()) return false;
    const file = await this.load(chapter);
    const latest = file.versions.at(-1);
    if (latest && latest.text === text) return false;
    const id = file.versions.reduce((max, version) => Math.max(max, version.id), 0) + 1;
    const next = [...file.versions, { id, ts: new Date().toISOString(), source, words: countWords(text), text }];
    const trimmed = next.length > MAX_VERSIONS_PER_CHAPTER ? next.slice(next.length - MAX_VERSIONS_PER_CHAPTER) : next;
    await this.io.writeJSON(filePath(chapter), { versions: trimmed });
    return true;
  }

  private async load(chapter: number): Promise<VersionFile> {
    const data = await this.io.readJSON<VersionFile>(filePath(chapter));
    if (!data) return { versions: [] };
    const parsed = VersionFileSchema.safeParse(data);
    return parsed.success ? parsed.data : { versions: [] };
  }
}
