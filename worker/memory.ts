/**
 * P11-C7 边缘记忆层：逐章写作的一致性上下文。
 * 前文摘要回溯 + 角色卡 + 伏笔台账 + BM25 关键词相关性排序。
 * 数据键与主线兼容：meta/entities.json、meta/foreshadows.json、summaries/NN.json。
 */

import { z } from "zod";
import { bm25Search, type Bm25Doc } from "../src/retrieval/bm25.js";
import { EntitySchema, type Entity } from "../src/domain/entity.js";
import { ForeshadowFileSchema, type ForeshadowTrack } from "../src/domain/foreshadow.js";
import type { KvBackend } from "./types.js";

export interface MemoryBundle {
  /** 排序后的前文摘要（与本章大纲相关性优先）。 */
  summaries: Array<{ chapter: number; summary: string; score: number }>;
  /** 上一章结尾片段（衔接用）。 */
  previousEnding: string | null;
  /** 本章登场角色（按相关度）。 */
  characters: Array<{ name: string; description: string; mood: string; goals: string[] }>;
  /** 未回收伏笔（planted/hinted/misled，按紧迫度）。 */
  openForeshadows: Array<{ title: string; description: string; urgency: string; plantedChapter: number }>;
}

/** 渲染为写手 system 附加块；空记忆返回空串。 */
export function renderMemoryBlock(bundle: MemoryBundle): string {
  const sections: string[] = [];
  if (bundle.summaries.length) {
    sections.push(`【前文回顾】\n${bundle.summaries.map((item) => `第 ${item.chapter} 章：${item.summary}`).join("\n")}`);
  }
  if (bundle.previousEnding) {
    sections.push(`【上一章结尾】\n${bundle.previousEnding}`);
  }
  if (bundle.characters.length) {
    sections.push(`【登场角色】\n${bundle.characters.map((character) => `- ${character.name}（${character.description}；当前情绪：${character.mood}${character.goals.length ? `；目标：${character.goals.join("、")}` : ""}）`).join("\n")}`);
  }
  if (bundle.openForeshadows.length) {
    sections.push(`【未回收伏笔】\n${bundle.openForeshadows.map((item) => `- ${item.title}：${item.description}（第 ${item.plantedChapter} 章埋设，紧迫度 ${item.urgency}）`).join("\n")}`);
  }
  return sections.join("\n\n");
}

const URGENCY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const z_EntityArray = z.array(z.record(z.unknown()));

/** 组装第 chapter 章写作的记忆上下文。query = 本章标题 + 大纲。 */
export async function buildChapterContext(kv: KvBackend, bookId: string, chapter: number, query: string, tailChars = 400): Promise<MemoryBundle> {
  const [summaries, previousEnding, characters, openForeshadows] = await Promise.all([
    loadSummaries(kv, bookId, chapter, query),
    loadPreviousEnding(kv, bookId, chapter, tailChars),
    loadCharacters(kv, bookId, query),
    loadOpenForeshadows(kv, bookId),
  ]);
  return { summaries, previousEnding, characters, openForeshadows };
}

async function loadSummaries(kv: KvBackend, bookId: string, chapter: number, query: string): Promise<MemoryBundle["summaries"]> {
  const keys = (await kv.list(`books/${bookId}/summaries/`)).filter((key) => /\.json$/.test(key));
  const docs: Array<Bm25Doc & { chapter: number; summary: string }> = [];
  for (const key of keys) {
    const match = key.match(/(\d+)\.json$/);
    const num = match ? Number(match[1]) : 0;
    if (!num || num >= chapter) continue;
    try {
      const parsed = JSON.parse((await kv.get(key)) ?? "{}") as { summary?: unknown };
      const summary = typeof parsed.summary === "string" ? parsed.summary : "";
      if (summary) docs.push({ id: num, text: summary, chapter: num, summary });
    } catch { /* 跳过坏行 */ }
  }
  if (!docs.length) return [];
  const hits = new Map(bm25Search(docs, query, 6).map((hit) => [hit.id, hit.score]));
  return docs
    .map((doc) => ({ chapter: doc.chapter, summary: doc.summary, score: hits.get(doc.id) ?? 0 }))
    .sort((a, b) => b.score - a.score || b.chapter - a.chapter)
    .slice(0, 5);
}

async function loadPreviousEnding(kv: KvBackend, bookId: string, chapter: number, tailChars: number): Promise<string | null> {
  if (chapter <= 1) return null;
  for (const key of [`books/${bookId}/chapters/${String(chapter - 1).padStart(2, "0")}.md`, `books/${bookId}/chapters/${chapter - 1}.md`]) {
    const text = await kv.get(key);
    if (text) {
      const body = text.replace(/^#\s*[^\n]*\n+/, "").trimEnd();
      return body.length > tailChars ? `…${body.slice(-tailChars)}` : body;
    }
  }
  return null;
}

async function loadCharacters(kv: KvBackend, bookId: string, query: string): Promise<MemoryBundle["characters"]> {
  const raw = await kv.get(`books/${bookId}/meta/entities.json`);
  if (!raw) return [];
  let entities: Entity[] = [];
  try {
    const parsed: unknown = JSON.parse(raw);
    const file = z_EntityArray.safeParse(parsed);
    entities = (file.success ? file.data : []).map((item) => EntitySchema.safeParse(item)).filter((result) => result.success).map((result) => result.data);
  } catch { return []; }
  const characters = entities.filter((entity) => entity.type === "character");
  if (!characters.length) return [];
  const docs: Array<Bm25Doc & { entity: Entity }> = characters.map((entity, index) => ({ id: index, text: `${entity.name} ${entity.aliases.join(" ")} ${entity.description}`, entity }));
  const hits = new Map(bm25Search(docs, query, 6).map((hit) => [hit.id, hit.score]));
  return characters
    .map((entity, index) => {
      const latest = entity.states.slice(-1).pop();
      return { name: entity.name, description: entity.description, mood: latest?.mood ?? "平淡", goals: latest?.goals ?? [], score: hits.get(index) ?? 0 };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map(({ name, description, mood, goals }) => ({ name, description, mood, goals }));
}

async function loadOpenForeshadows(kv: KvBackend, bookId: string): Promise<MemoryBundle["openForeshadows"]> {
  const raw = await kv.get(`books/${bookId}/meta/foreshadows.json`);
  if (!raw) return [];
  try {
    const file = ForeshadowFileSchema.parse(JSON.parse(raw));
    return file.items
      .filter((item) => item.stage !== "resolved")
      .sort((a, b) => (URGENCY_ORDER[a.urgency] ?? 9) - (URGENCY_ORDER[b.urgency] ?? 9) || a.plantedChapter - b.plantedChapter)
      .slice(0, 8)
      .map((item: ForeshadowTrack) => ({ title: item.title, description: item.description, urgency: item.urgency, plantedChapter: item.plantedChapter }));
  } catch { return []; }
}
