import { bm25Search } from "./bm25.js";
import { cosineSimilarity, embedTexts, type EmbeddingConfig } from "./embedding.js";
import { effectiveSkillPacks } from "../domain/skillpack.js";
import type { Store } from "../store/index.js";

/**
 * 设定检索（specs/2026-09-19-p4-competitive-parity R1）。
 * 统一语料：实体图谱 + 章节摘要 + 伏笔线索（compass.open_threads）；
 * embedding 可用则向量优先，失败回落 BM25。零新增依赖。
 */

export type RecallKind = "entity" | "summary" | "foreshadow" | "material" | "constitution" | "skillpack";

export interface RecallDoc { id: number; kind: RecallKind; source: string; text: string }
export interface RecallHit { kind: RecallKind; source: string; score: number; snippet: string }

function clip(text: string, max = 120): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : flat + "…";
}

export async function buildRecallCorpus(store: Store): Promise<RecallDoc[]> {
  const docs: RecallDoc[] = [];
  const entities = await store.entities.load();
  for (const entity of entities.entities) {
    const relations = entity.relations.map((relation) => `${relation.type}:${relation.targetId}(${relation.strength})`).join(" ");
    const text = [entity.name, ...entity.aliases].join("/") + " " + entity.description + (relations ? " 关系:" + relations : "");
    docs.push({ id: docs.length, kind: "entity", source: entity.name, text });
  }

  const progress = await store.progress.load();
  const outlineEntries = await store.outline.loadOutline();
  const titles = new Map(outlineEntries.map((entry) => [entry.chapter, entry.title]));
  const chapterNumbers = [...new Set([...(progress?.completed_chapters ?? []), ...outlineEntries.map((entry) => entry.chapter)])].sort((a, b) => a - b);
  for (const chapter of chapterNumbers) {
    const summary = await store.summaries.loadSummary(chapter);
    if (!summary?.summary) continue;
    const title = titles.get(chapter) ?? `第 ${chapter} 章`;
    docs.push({ id: docs.length, kind: "summary", source: `第 ${chapter} 章 ${title}`, text: `${title}: ${summary.summary} ${(summary.key_events ?? []).join(";")}` });
  }

  const compass = await store.outline.loadCompass();
  for (const [index, thread] of (compass?.open_threads ?? []).entries()) {
    if (!thread.trim()) continue;
    docs.push({ id: docs.length, kind: "foreshadow", source: thread.slice(0, 40), text: `[伏笔] ${thread}` });
    void index;
  }

  const materials = await store.materials.load();
  for (const material of materials.materials) {
    docs.push({ id: docs.length, kind: "material", source: material.title, text: `[素材:${material.type}] ${material.title}: ${material.content} ${material.tags.join(" ")}` });
  }

  const constitution = await store.constitution.load().catch(() => null);
  if (constitution) {
    const groups: Array<[string, string[]]> = [["世界规则", constitution.worldRules], ["能力代价", constitution.abilityCosts], ["禁写信息", constitution.forbiddenInfo], ["人物行为边界", constitution.characterBoundaries]];
    for (const [label, rules] of groups) for (const rule of rules) docs.push({ id: docs.length, kind: "constitution", source: label, text: `[宪法:${label}] ${rule}` });
    for (const reveal of constitution.secretReveals) docs.push({ id: docs.length, kind: "constitution", source: "秘密揭晓计划", text: `[宪法:秘密] 「${reveal.secret}」计划于${reveal.revealAt}揭晓` });
  }

  const skillPackFile = await store.skillpacks.load().catch(() => null);
  if (skillPackFile) {
    for (const pack of effectiveSkillPacks(skillPackFile)) {
      for (const technique of pack.techniques) docs.push({ id: docs.length, kind: "skillpack", source: pack.name, text: `[技法:${pack.name}] ${technique}` });
    }
  }

  const foreshadowStore = (store as Store & { foreshadows?: { load(): Promise<{ items: Array<{ title: string; description: string; type: string; stage: string }> }> } }).foreshadows;
  if (foreshadowStore) {
    const tracks = (await foreshadowStore.load().catch(() => ({ items: [] }))).items;
    for (const track of tracks) docs.push({ id: docs.length, kind: "foreshadow", source: track.title, text: `[伏笔:${track.type}] ${track.title}: ${track.description} 状态:${track.stage}` });
  }
  return docs;
}

export interface RecallOptions { k?: number; embedding?: EmbeddingConfig }

export async function recall(store: Store, query: string, options: RecallOptions = {}): Promise<{ engine: "embedding" | "bm25" | "rrf"; hits: RecallHit[] }> {
  const k = options.k ?? 8;
  const corpus = await buildRecallCorpus(store);
  if (!corpus.length || !query.trim()) return { engine: "bm25", hits: [] };

  const decorate = (hit: { id: number; score: number }): RecallHit => { const doc = corpus[hit.id]!; return { kind: doc.kind, source: doc.source, score: Math.round(hit.score * 1000) / 1000, snippet: clip(doc.text) }; };

  if (options.embedding?.api_key) {
    try {
      const vectors = await embedTexts(options.embedding, [...corpus.map((doc) => doc.text), query]);
      const queryVector = vectors[vectors.length - 1]!;
      const vectorRanked = corpus
        .map((doc, index) => ({ id: doc.id, score: cosineSimilarity(queryVector, vectors[index]!) }))
        .filter((hit) => hit.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, k * 2);
      const bm25Ranked = bm25Search(corpus.map((doc) => ({ id: doc.id, text: doc.text })), query, k * 2);
      if (vectorRanked.length || bm25Ranked.length) {
        // RRF 融合：score = Σ 1/(60 + rank)，双路召回按倒数排名合并
        const fused = new Map<number, number>();
        for (const [index, hit] of vectorRanked.entries()) fused.set(hit.id, (fused.get(hit.id) ?? 0) + 1 / (60 + index + 1));
        for (const [index, hit] of bm25Ranked.entries()) fused.set(hit.id, (fused.get(hit.id) ?? 0) + 1 / (60 + index + 1));
        const hits = [...fused.entries()]
          .map(([id, score]) => ({ id, score }))
          .sort((a, b) => b.score - a.score)
          .slice(0, k)
          .map(decorate);
        if (hits.length) return { engine: "rrf", hits };
      }
    } catch { /* 嵌入失败回落 BM25 */ }
  }

  const hits = bm25Search(corpus.map((doc) => ({ id: doc.id, text: doc.text })), query, k).map(decorate);
  return { engine: "bm25", hits };
}
