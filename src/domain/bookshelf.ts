import { z } from "zod";

/**
 * 多书管理领域模型（P7-1 书架）。
 * 每本书 = 书籍根目录下的一个子目录（完整 Store 工作区），
 * 注册表持久化为 <booksRoot>/bookshelf.json，activeId 指向当前书籍。
 */

export const BookMetaSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(60),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type BookMeta = z.infer<typeof BookMetaSchema>;

export const BookshelfFileSchema = z.object({
  books: z.array(BookMetaSchema).default([]),
  activeId: z.string().nullable().default(null),
  updatedAt: z.string().default(new Date().toISOString()),
});
export type BookshelfFile = z.infer<typeof BookshelfFileSchema>;

export const BOOKSHELF_PATH = "bookshelf.json";

export function emptyBookshelf(): BookshelfFile {
  return { books: [], activeId: null, updatedAt: new Date().toISOString() };
}

/** 书籍根目录 = output_dir 的父目录；output/novel → output。 */
export function resolveBooksRoot(outputDir: string): string {
  const normalized = outputDir.replace(/\\/g, "/").replace(/\/+$/, "");
  const slash = normalized.lastIndexOf("/");
  return slash > 0 ? normalized.slice(0, slash) : ".";
}

/** 目录名或 id：优先使用标题中的 ASCII 词，缺省回退 book-<日期>-<随机>。 */
export function createBookId(title: string, now = new Date()): string {
  const ascii = title.toLowerCase().match(/[a-z0-9]+/g)?.join("-") ?? "";
  const suffix = `${now.getFullYear().toString().slice(2)}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const rand = Math.random().toString(36).slice(2, 6);
  const base = ascii ? ascii.slice(0, 30) : "book";
  return `${base}-${suffix}-${rand}`;
}

/** 压缩空白并截断到 max 位的通用名称归一化（书名/技能包名共用）。 */
export function normalizeTitle(input: string, max = 60): string {
  const trimmed = input.trim().replace(/\s+/g, " ");
  return trimmed.slice(0, max);
}
