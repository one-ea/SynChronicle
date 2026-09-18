import { z } from "zod";
import type { OutlineEntry, Progress, ReviewEntry, RunMeta, VolumeOutline } from "../domain/index.js";
import type { RegisteredTool, ToolRegistryOptions } from "./registry.js";
import { buildSnapshot, type Candidate, type Snapshot } from "../rules/index.js";
import { compute, type StyleStats } from "../stylestat/index.js";
import { detectAitone } from "../stylestat/aitone.js";
import { formatMessage, route } from "../runtime/flow/router.js";
import { bm25Search, type Bm25Doc } from "../retrieval/bm25.js";
import { cosineSimilarity, embedTexts } from "../retrieval/embedding.js";
import { createHash } from "node:crypto";

const positiveInt = z.number().int().positive();
const strings = z.array(z.string());
const chapterScope = (chapter: number) => ({ kind: "chapter" as const, chapter });
const pad = (value: number) => String(value).padStart(2, "0");

/**
 * 参考资料按角色裁剪（`reference_pack` 注入）：
 * - writer：每章都要遵守的写作纪律（反 AI 腔 / 一致性 / 质量清单 / 章节指南 / 钩子技巧）
 * - architect：规划类（长篇规划 / 大纲模板 / 情节结构 / 弧模板 / 题材风格参考）
 * - editor：评审类（一致性 / 质量清单 / 反 AI 腔）
 * - coordinator：不注入（进度与指令足够）
 * 裁剪白名单保持克制：references 总量 ~64KB，全量注入每章不划算。
 */
const REFERENCE_BY_ROLE: Record<string, string[]> = {
  writer: ["antiAiTone", "chapterGuide", "consistency", "qualityChecklist", "hookTechniques", "dialogueWriting"],
  architect: ["longformPlanning", "outlineTemplate", "plotStructures", "arcTemplates", "styleReference"],
  editor: ["consistency", "qualityChecklist", "antiAiTone"],
};

function pickReferences(consumer: string | undefined, references: Record<string, string> | undefined): Record<string, string> {
  if (!references) return {};
  const out: Record<string, string> = {};
  for (const key of REFERENCE_BY_ROLE[consumer ?? ""] ?? []) {
    const value = references[key];
    if (value) out[key] = value;
  }
  return out;
}

/** 进程内 style_stats 缓存：key = dir + 已完成章数 + 总字数，任何推进即失效。 */
const styleStatsCache = new Map<string, StyleStats>();

async function computeStyleStats(store: ToolRegistryOptions["store"]): Promise<StyleStats | null> {
  const progress = await store.progress.load();
  if (!progress) return null;
  const completed = [...progress.completed_chapters].sort((a, b) => a - b);
  if (completed.length < 5) return null;
  const cacheKey = `${store.dir}:${completed.length}:${progress.total_word_count}`;
  const cached = styleStatsCache.get(cacheKey);
  if (cached) return cached;
  const texts: string[] = [];
  for (const chapter of completed) texts.push(await store.drafts.loadChapterText(chapter));
  const outline = await store.outline.loadOutline();
  const titles = completed.map(chapter => outline.find(entry => entry.chapter === chapter)?.title ?? "");
  const stats = compute({ chapters: texts, titles, stopwords: [] });
  if (stats) styleStatsCache.set(cacheKey, stats);
  return stats;
}

function registered<T extends z.ZodTypeAny>(description: string, inputSchema: T, execute: RegisteredTool<T>["execute"]): RegisteredTool<T> {
  return { description, inputSchema, execute: async (input, context) => execute(inputSchema.parse(input), context) };
}

export function createTools({ store, askUser, references, normalize, subagents }: ToolRegistryOptions) {
  const novelContextSchema = z.object({ chapter: positiveInt.optional(), consumer: z.enum(["architect", "writer", "editor", "coordinator"]).optional() }).strict();
  const saveFoundationSchema = z.object({ type: z.enum(["premise", "outline", "layered_outline", "characters", "world_rules", "expand_arc", "append_volume", "update_compass", "complete_book"]), content: z.unknown(), scale: z.enum(["short", "mid", "long"]).optional(), volume: positiveInt.optional(), arc: positiveInt.optional() }).strict();
  const planChapterSchema = z.object({ chapter: positiveInt, title: z.string(), goal: z.string(), conflict: z.string(), hook: z.string(), emotion_arc: z.string().optional(), notes: z.string().optional(), required_beats: strings.optional(), forbidden_moves: strings.optional(), continuity_checks: strings.optional(), evaluation_focus: strings.optional(), emotion_target: z.string().optional(), payoff_points: strings.optional(), hook_goal: z.string().optional() }).strict();
  const draftChapterSchema = z.object({ chapter: positiveInt, content: z.string().min(1), mode: z.enum(["write", "append"]) }).strict();
  const editChapterSchema = z.object({ chapter: positiveInt, old_string: z.string().min(1), new_string: z.string(), replace_all: z.boolean().default(false) }).strict();
  const chapterOnlySchema = z.object({ chapter: positiveInt }).strict();
  const commitChapterSchema = z.object({ chapter: positiveInt, summary: z.string(), characters: strings, key_events: strings, hook_type: z.string().optional(), dominant_strand: z.string().optional() }).passthrough();
  const readChapterSchema = z.object({ chapter: positiveInt.optional(), from: positiveInt.optional(), to: positiveInt.optional(), source: z.enum(["final", "draft"]), character: z.string().optional(), max_runes: positiveInt.optional() }).strict();
  const dimensionSchema = z.object({ dimension: z.enum(["consistency", "character", "pacing", "continuity", "foreshadow", "hook", "aesthetic"]), score: z.number().int().min(0).max(100), verdict: z.string().optional(), comment: z.string().min(1) }).strict();
  const saveReviewSchema = z.object({ chapter: positiveInt, scope: z.enum(["chapter", "global", "arc"]), dimensions: z.array(dimensionSchema).length(7), issues: z.array(z.object({ type: z.string(), severity: z.string(), description: z.string(), evidence: z.string().optional(), suggestion: z.string().optional() }).strict()), contract_status: z.enum(["met", "partial", "missed"]).optional(), contract_misses: strings.optional(), contract_notes: z.string().optional(), verdict: z.enum(["accept", "polish", "rewrite"]), summary: z.string().min(1), affected_chapters: z.array(positiveInt).optional() }).strict();
  const saveArcSummarySchema = z.object({ volume: positiveInt, arc: positiveInt, title: z.string(), summary: z.string(), key_events: strings, character_snapshots: z.array(z.object({ name: z.string(), status: z.string(), power: z.string().optional(), motivation: z.string(), relations: z.string().optional() }).strict()), style_rules: z.object({ prose: strings.min(1), dialogue: z.array(z.object({ name: z.string().min(1), rules: strings.min(1) }).strict()).min(1), taboos: strings.optional() }).strict().optional() }).strict();
  const saveVolumeSummarySchema = z.object({ volume: positiveInt, title: z.string(), summary: z.string(), key_events: strings }).strict();
  const savePausePointSchema = z.object({ after: z.string().optional(), reason: z.string().default(""), cancel: z.boolean().default(false) }).strict();
  const saveUserRulesSchema = z.object({ text: z.string().trim().min(1) }).strict();
  const questionSchema = z.object({ question: z.string().min(1), header: z.string().min(1).max(12), options: z.array(z.object({ label: z.string().min(1), description: z.string().min(1) }).strict()).min(2).max(4), multiSelect: z.boolean().default(false) }).strict();
  const askUserSchema = z.object({ questions: z.array(questionSchema).min(1).max(4) }).strict();
  const reopenBookSchema = z.object({ chapters: z.array(positiveInt).min(1), reason: z.string().default("") }).strict();
  const subagentSchema = z.object({ agent: z.enum(["architect_short", "architect_long", "writer", "editor"]), task: z.string().min(1) }).strict();

  const tools = {
    novel_context: registered("获取小说当前状态和创作上下文", novelContextSchema, async ({ chapter, consumer }) => {
      const resolvedConsumer = consumer ?? (chapter ? "writer" : "architect");
      if ((resolvedConsumer === "writer" || resolvedConsumer === "editor") && !chapter) throw new Error(`chapter must be > 0 for consumer ${resolvedConsumer}`);
      const progress = await store.progress.load();
      const working = { user_rules: await store.userRules.load() ?? {} };
      if (resolvedConsumer === "coordinator") return { progress_status: progressStatus(progress), foundation_status: await store.foundationMissing(), working_memory: working, reference_pack: {} };
      if (resolvedConsumer === "architect") return { progress_status: progressStatus(progress), planning_memory: { outline: await store.outline.loadOutline() }, foundation_memory: await foundation(store), reference_pack: pickReferences("architect", references), working_memory: working };
      const style_stats = await computeStyleStats(store);
      const selected_memory = resolvedConsumer === "writer" ? await retrieveRelatedChapters(store, progress, chapter!) : {};
      const style_guard = resolvedConsumer === "writer" ? buildStyleGuard(style_stats) : undefined;
      const quality_signals = resolvedConsumer === "editor" ? await buildQualitySignals(store, chapter!) : undefined;
      return {
        working_memory: { ...working, chapter_plan: await store.drafts.loadChapterPlan(chapter!) },
        episodic_memory: style_stats ? { style_stats } : {},
        reference_pack: pickReferences(resolvedConsumer, references),
        ...(resolvedConsumer === "writer" ? { selected_memory: { ...selected_memory, ...(style_guard ? { style_guard } : {}) } } : {}),
        ...(quality_signals ? { quality_signals } : {}),
      };
    }),
    save_foundation: registered("保存小说基础设定", saveFoundationSchema, async ({ type, content, scale, volume, arc }) => {
      if (scale) await saveRunMeta(store, { planning_tier: scale });
      if (type === "premise") { const text = String(content); await store.outline.savePremise(text); const name = text.match(/^#\s+(.+)$/m)?.[1]?.trim(); if (name) await store.progress.setNovelName(name); await store.progress.updatePhase("premise"); }
      else if (type === "outline") { const entries = parseContent<OutlineEntry[]>(content); await store.outline.saveOutline(entries); await store.progress.setTotalChapters(entries.length); await store.progress.updatePhase("outline"); }
      else if (type === "layered_outline") { const volumes = parseContent<VolumeOutline[]>(content); await store.outline.saveLayeredOutline(volumes); const entries = volumes.flatMap((volume) => volume.arcs.flatMap((arc) => arc.chapters ?? [])); await store.outline.saveOutline(entries); await store.progress.setTotalChapters(entries.length); await store.progress.setLayered(true); await store.progress.updatePhase("outline"); }
      else if (type === "characters") await store.characters.save(parseContent(content));
      else if (type === "world_rules") await store.world.saveWorldRules(parseContent(content));
      else if (type === "expand_arc") {
        if (!volume || !arc) throw new Error("expand_arc requires volume and arc parameters");
        const volumes = await store.outline.loadLayeredOutline(); const target = volumes.find((item) => item.index === volume)?.arcs.find((item) => item.index === arc); if (!target) throw new Error(`arc V${volume}A${arc} not found`);
        target.chapters = parseContent<OutlineEntry[]>(content); await store.outline.saveLayeredOutline(volumes); const entries = volumes.flatMap((item) => item.arcs.flatMap((itemArc) => itemArc.chapters ?? [])); await store.outline.saveOutline(entries); await store.progress.setTotalChapters(entries.length);
      }
      else if (type === "append_volume") { const volumes = await store.outline.loadLayeredOutline(); volumes.push(parseContent<VolumeOutline>(content)); await store.outline.saveLayeredOutline(volumes); const entries = volumes.flatMap((item) => item.arcs.flatMap((itemArc) => itemArc.chapters ?? [])); await store.outline.saveOutline(entries); await store.progress.setTotalChapters(entries.length); await store.progress.setLayered(true); }
      else if (type === "update_compass") await store.outline.saveCompass(parseContent(content));
      else if (type === "complete_book") await store.progress.markComplete();
      await store.checkpoints.appendArtifact({ kind: "global" }, type, type === "premise" ? "premise.md" : type === "complete_book" ? "meta/progress.json" : foundationArtifact(type));
      return { saved: true, type, scale };
    }),
    plan_chapter: registered("保存章节写作构思", planChapterSchema, async (input) => {
      if (await store.progress.isChapterCompleted(input.chapter)) return { chapter: input.chapter, skipped: true, completed: true };
      await store.progress.validateChapterWork(input.chapter);
      const { required_beats, forbidden_moves, continuity_checks, evaluation_focus, emotion_target, payoff_points, hook_goal, ...plan } = input;
      await store.drafts.saveChapterPlan({ ...plan, contract: { required_beats, forbidden_moves, continuity_checks, evaluation_focus, emotion_target, payoff_points, hook_goal } });
      await store.progress.startChapter(input.chapter);
      await store.checkpoints.appendArtifact(chapterScope(input.chapter), "plan", `drafts/${pad(input.chapter)}.plan.json`);
      return { planned: true, chapter: input.chapter };
    }),
    draft_chapter: registered("写入章节正文", draftChapterSchema, async ({ chapter, content, mode }) => {
      await store.progress.validateChapterWork(chapter); await store.progress.startChapter(chapter);
      if (mode === "append") await store.drafts.appendDraft(chapter, content); else await store.drafts.saveDraft(chapter, content);
      await store.checkpoints.appendArtifact(chapterScope(chapter), "draft", `drafts/${pad(chapter)}.draft.md`);
      return { written: true, chapter, mode, word_count: [...await store.drafts.loadDraft(chapter)].length };
    }),
    edit_chapter: registered("对章节草稿做定点字符串替换", editChapterSchema, async ({ chapter, old_string, new_string, replace_all }) => {
      await store.progress.validateChapterWork(chapter);
      let text = await store.drafts.loadDraft(chapter); if (!text) { text = await store.drafts.loadChapterText(chapter); if (text) await store.drafts.saveDraft(chapter, text); }
      if (!text) throw new Error(`第 ${chapter} 章无草稿也无终稿`); const count = text.split(old_string).length - 1;
      if (!count) throw new Error("old_string not found"); if (count > 1 && !replace_all) throw new Error("old_string matches multiple locations");
      const next = replace_all ? text.split(old_string).join(new_string) : text.replace(old_string, new_string); await store.drafts.saveDraft(chapter, next);
      await store.checkpoints.appendArtifact(chapterScope(chapter), "edit", `drafts/${pad(chapter)}.draft.md`); return { edited: true, chapter, replacements: replace_all ? count : 1 };
    }),
    check_consistency: registered("加载草稿和一致性对照数据", chapterOnlySchema, async ({ chapter }) => {
      const content = await store.drafts.loadDraft(chapter) || await store.drafts.loadChapterText(chapter); if (!content) throw new Error(`no content found for chapter ${chapter}`);
      await store.checkpoints.appendArtifact(chapterScope(chapter), "consistency_check", `drafts/${pad(chapter)}.draft.md`); return { chapter, content, word_count: [...content].length, world_rules: await store.world.loadWorldRules() };
    }),
    commit_chapter: registered("提交章节终稿", commitChapterSchema, async ({ chapter, summary, characters, key_events, hook_type = "", dominant_strand = "" }) => {
      await store.progress.validateChapterWork(chapter);
      const content = await store.drafts.loadDraft(chapter) || await store.drafts.loadChapterText(chapter); if (!content) throw new Error(`no content found for chapter ${chapter}`);
      await store.drafts.saveFinalChapter(chapter, content); await store.summaries.saveSummary({ chapter, summary, characters, key_events });
      const known = Object.fromEntries((await store.characters.load()).map((character) => [character.name, true])); await store.cast.mergeAppearances(chapter, characters, [], known);
      if (await store.progress.isChapterCompleted(chapter)) await store.progress.completeRewrite(chapter); else await store.progress.markChapterComplete(chapter, [...content].length, hook_type, dominant_strand);
      await store.checkpoints.appendArtifact(chapterScope(chapter), "commit", `chapters/${pad(chapter)}.md`);
      await store.signals.clearPendingCommit();
      return { committed: true, chapter, word_count: [...content].length };
    }),
    read_chapter: registered("读取章节原文", readChapterSchema, async ({ chapter, from, to, source, character, max_runes = 2000 }) => {
      if (character) return { character, samples: [] };
      if (from && to) return { chapters: await store.drafts.loadChapterRange(from, to, max_runes), from, to };
      if (!chapter) throw new Error("chapter is required"); let content = source === "draft" ? await store.drafts.loadDraft(chapter) : await store.drafts.loadChapterText(chapter); if (!content && source === "final") content = await store.drafts.loadDraft(chapter);
      return content ? { chapter, content, word_count: [...content].length } : { chapter, exists: false };
    }),
    save_review: registered("保存审阅结果并更新流程状态", saveReviewSchema, async (input) => {
      const dimensions = input.dimensions.map((dimension) => ({ ...dimension, verdict: dimension.score >= 80 ? "pass" : dimension.score >= 60 ? "warning" : "fail" }));
      const verdict = input.verdict === "accept" && (input.contract_status === "missed" || dimensions.some((item) => item.score < 60)) ? "rewrite" : input.verdict === "accept" && (input.contract_status === "partial" || dimensions.some((item) => item.score < 80)) ? "polish" : input.verdict;
      const affected = verdict === "accept" ? [] : input.affected_chapters?.length ? input.affected_chapters : [input.chapter];
      if (affected.length) await store.progress.setPendingRewrites(affected, input.summary);
      await store.progress.setFlow(verdict === "rewrite" ? "rewriting" : verdict === "polish" ? "polishing" : "writing");
      const review: ReviewEntry = { ...input, dimensions, affected_chapters: affected }; await store.writeArtifact(`reviews/${pad(input.chapter)}${input.scope === "global" ? "-global" : ""}.json`, review);
      await store.checkpoints.appendArtifact(chapterScope(input.chapter), "review", `reviews/${pad(input.chapter)}${input.scope === "global" ? "-global" : ""}.json`); return { saved: true, chapter: input.chapter, final_verdict: verdict, affected_chapters: affected };
    }),
    save_arc_summary: registered("保存弧级摘要和角色快照", saveArcSummarySchema, async ({ character_snapshots, style_rules, ...summary }) => {
      await store.summaries.saveArcSummary(summary); if (character_snapshots.length) await store.characters.saveSnapshots(summary.volume, summary.arc, character_snapshots.map((item) => ({ ...item, volume: summary.volume, arc: summary.arc })));
      if (style_rules) await store.writeArtifact("meta/style_rules.json", { volume: summary.volume, arc: summary.arc, ...style_rules, taboos: style_rules.taboos ?? [], updated_at: new Date().toISOString() });
      await store.checkpoints.appendArtifact({ kind: "arc", volume: summary.volume, arc: summary.arc }, "arc_summary", `summaries/arc-v${pad(summary.volume)}a${pad(summary.arc)}.json`); return { saved: true, type: "arc_summary", volume: summary.volume, arc: summary.arc };
    }),
    save_volume_summary: registered("保存卷级摘要", saveVolumeSummarySchema, async (summary) => { await store.summaries.saveVolumeSummary(summary); await store.checkpoints.appendArtifact({ kind: "volume", volume: summary.volume }, "volume_summary", `summaries/vol-v${pad(summary.volume)}.json`); return { saved: true, type: "volume_summary", volume: summary.volume }; }),
    save_pause_point: registered("登记用户验收停靠点", savePausePointSchema, async ({ after, reason, cancel }) => {
      const current = await store.runMeta.load() as RunMeta | null; if (cancel) { await store.runMeta.save({ ...defaultRunMeta(), ...current, pause_point: null }); return { pause_point_cleared: Boolean(current?.pause_point) }; }
      if (after !== "rewrites_drained" && after !== "rewrite_queue_empty") throw new Error('after 仅支持 "rewrites_drained" 或 "rewrite_queue_empty"'); if ((await store.progress.load())?.phase !== "writing") throw new Error("停靠点仅在写作期可设");
      await store.runMeta.save({ ...defaultRunMeta(), ...current, pause_point: { after, reason, set_at: new Date().toISOString() } }); return { pause_point_set: true, after, reason };
    }),
    save_user_rules: registered("保存长效写作规则", saveUserRulesSchema, async ({ text }) => {
      const snapshot = await mergeUserRule(store, normalize, text);
      return { saved: true, status: snapshot.status, understood: snapshot, in_effect: snapshot };
    }),
    ask_user: registered("向用户提出结构化问题", askUserSchema, async ({ questions }) => { if (!askUser) return "当前环境不支持交互式询问，请根据你的判断自行决策并继续。"; const response = await askUser(questions); const parts = questions.flatMap((question) => { const answer = response.answers[question.question]; if (!answer) return []; const note = response.notes?.[question.question]; return [`[${question.header}] ${answer}${note ? `（补充：${note}）` : ""}`]; }); return parts.length ? `用户回答：${parts.join("；")}` : "用户未提供回答，请根据你的判断自行决策并继续。"; }),
    reopen_book: registered("把已完结的书重新打开进入返工态", reopenBookSchema, async ({ chapters, reason }) => {
      const progress = await store.progress.load(); if (!progress || progress.phase !== "complete") throw new Error("reopen_book 仅支持已完结小说"); if (chapters.some((chapter) => !progress.completed_chapters.includes(chapter))) throw new Error("reopen 只能返工已完成章节");
      await store.progress.save({ ...progress, phase: "writing", flow: "rewriting", pending_rewrites: chapters, rewrite_reason: reason, reopened_from_complete: true }); await store.checkpoints.appendArtifact({ kind: "global" }, "reopen", "meta/progress.json"); return { reopened: true, phase: "writing", pending_rewrites: chapters };
    }),
    subagent: registered("调用子代理执行创作子任务（architect 规划 / writer 写章 / editor 评审）", subagentSchema, async ({ agent, task }) => {
      const target = subagents?.()[agent];
      if (!target) return { error: `子代理 ${agent} 不可用（未装配）` };
      // CheckpointDeltaGuard（docs/architecture.md §6.4）：任务完成但未产生新 checkpoint → 结构化警告，
      // 由 Coordinator 核对后重派；不抛错（错误会中断工具循环，警告保留给模型裁定）。
      const before = (await store.checkpoints.all()).length;
      const result = await target.generate(task);
      const after = (await store.checkpoints.all()).length;
      const text = typeof result.text === "string" ? result.text : String(result.text);
      // Host 同步边界：子代理返回后由 Flow Router 计算下一步指令并附加为事实，
      // 模型下一轮直接执行（AI SDK 无运行中注入通道，工具边界即注入点）。
      const progress = await store.progress.load();
      const instruction = route({
        progress: progress ? { phase: progress.phase, flow: progress.flow ?? "writing", completed_chapters: progress.completed_chapters, pending_rewrites: progress.pending_rewrites ?? [], layered: progress.layered } : null,
        lastCompleted: progress?.completed_chapters.at(-1),
      });
      const parts: string[] = [text];
      if (instruction) parts.push(formatMessage(instruction));
      if (after <= before) parts.push(`[CheckpointDeltaGuard] 子代理任务「${task}」完成但未产生任何新的 checkpoint（${before} → ${after}）。任务可能未真正推进，请核对事实后重派或继续下一步。`);
      return parts.join("\n\n");
    }),
  };
  return tools;
}

function parseContent<T>(content: unknown): T { return (typeof content === "string" ? JSON.parse(content) : content) as T; }

/**
 * 把一条运行时规则并入现有快照：
 * 1. 旧格式兼容——既有 `{status:"degraded", preferences}` 直存格式转成 Candidate 再合并；
 * 2. 有归一化器时走 LLM 归一化（失败在 normalizeRule 内部降级为原文偏好）；
 * 3. 无归一化器（如测试/离线）降级为原文偏好，与修复前行为一致。
 */
async function mergeUserRule(store: ToolRegistryOptions["store"], normalize: ((text: string) => Promise<Candidate>) | undefined, text: string): Promise<Snapshot> {
  const candidates: Candidate[] = [];
  const existing = await store.userRules.load();
  if (existing && typeof existing === "object") {
    const value = existing as Record<string, unknown>;
    if (typeof value.structured === "object" && value.structured !== null) {
      const previous = existing as unknown as Snapshot;
      candidates.push({ source: previous.sources?.join("、") || "previous", structured: previous.structured ?? {}, preferences: previous.preferences ?? "", uncertain: previous.uncertain ?? [], degraded: previous.status === "degraded" });
    } else if (typeof value.preferences === "string") {
      candidates.push({ source: "previous", structured: {}, preferences: value.preferences, uncertain: [], degraded: true });
    }
  }
  const candidate = normalize
    ? await normalize(text)
    : { source: "runtime_user", structured: {}, preferences: text, uncertain: [], degraded: true };
  candidates.push(candidate);
  const snapshot = buildSnapshot(candidates);
  await store.userRules.save(snapshot);
  return snapshot;
}
function foundationArtifact(type: string) { return ({ outline: "outline.json", layered_outline: "layered_outline.json", characters: "characters.json", world_rules: "world_rules.json", update_compass: "meta/compass.json" } as Record<string, string>)[type] ?? "meta/progress.json"; }
function progressStatus(progress: Progress | null) { return progress ? { phase: progress.phase, flow: progress.flow ?? "writing", completed_chapters: progress.completed_chapters.length, total_chapters: progress.total_chapters, next_chapter: Math.max(1, ...progress.completed_chapters.map((chapter) => chapter + 1)), total_word_count: progress.total_word_count, pending_rewrites: progress.pending_rewrites ?? [] } : null; }
async function foundation(store: ToolRegistryOptions["store"]) { return { premise: await store.outline.loadPremise(), outline: await store.outline.loadOutline(), characters: await store.characters.load(), world_rules: await store.world.loadWorldRules() }; }

/**
 * BM25 相关章节检索（specs/2026-09-18-quality-trio R1）：
 * 以当前章大纲为查询、已完成章摘要为语料，注入 selected_memory.related_chapters。
 * 排除最近 3 章摘要窗口（摘要窗口已覆盖），章数不足或大纲缺失时保持空对象。
 */
const SUMMARY_WINDOW = 3;
const vectorCache = new Map<string, { hash: string; vector: number[] }>();

/**
 * 文风护栏（specs/2026-09-18-p1-quality-depth R4）：
 * writer 拿到"本章规避清单"（stylestat 高频模式 + 固定 AI 味三类），
 * editor 拿到本章草稿的 AI 命中明细供评审举证。均为只读扩展。
 */
const FIXED_AVOID = ["量词癖『一丝/一抹/一缕』", "明喻套句『如同/宛如/仿佛…一般』", "对比定义句式『不是…而是…』"];
function buildStyleGuard(stats: StyleStats | null): { avoid: string[] } | undefined {
  const hot = (stats?.patterns ?? []).filter((pattern) => pattern.perChapter >= 2).slice(0, 5).map((pattern) => pattern.name);
  const avoid = [...new Set([...hot, ...FIXED_AVOID])];
  return avoid.length ? { avoid } : undefined;
}

async function buildQualitySignals(store: ToolRegistryOptions["store"], chapter: number): Promise<{ aitone: ReturnType<typeof detectAitone> } | undefined> {
  const draft = await store.drafts.loadDraft(chapter) || await store.drafts.loadChapterText(chapter);
  if (!draft) return undefined;
  const aitone = detectAitone(draft);
  return aitone && aitone.score < 100 ? { aitone } : undefined;
}

async function retrieveRelatedChapters(store: ToolRegistryOptions["store"], progress: Progress | null, chapter: number): Promise<Record<string, unknown>> {
  const completed = progress?.completed_chapters ?? [];
  if (completed.length < 2) return {};
  const outlineEntries = await store.outline.loadOutline();
  const entry = outlineEntries.find((item) => item.chapter === chapter);
  if (!entry) return {};
  const window = new Set(completed.slice(-SUMMARY_WINDOW));
  const corpus: Array<{ chapter: number; text: string }> = [];
  const summaries = new Map<number, { summary: string; keyEvents: string[] }>();
  for (const done of completed) {
    if (window.has(done)) continue;
    const summary = await store.summaries.loadSummary(done);
    if (!summary?.summary) continue;
    summaries.set(done, { summary: summary.summary, keyEvents: summary.key_events ?? [] });
    corpus.push({ chapter: done, text: `${summary.summary} ${summary.key_events.join(" ")}` });
  }
  if (corpus.length < 2) return {};
  const query = `${entry.title} ${entry.core_event} ${entry.hook ?? ""}`;
  const titles = new Map(outlineEntries.map((item) => [item.chapter, item.title]));
  const decorate = (hits: Array<{ id: number; score: number }>) =>
    hits.map((hit) => { const found = summaries.get(hit.id)!; return { chapter: hit.id, title: titles.get(hit.id) ?? `第 ${hit.id} 章`, summary: found.summary, key_events: found.keyEvents, score: hit.score }; });

  const embedding = (progress as Progress & { embedding?: { base_url?: string; model?: string; api_key?: string; dimensions?: number } } | null)?.embedding;
  if (embedding?.api_key) {
    try {
      const vectors: Array<number[] | undefined> = [];
      const pending: Array<{ index: number; text: string }> = [];
      corpus.forEach((item, index) => {
        const hash = createHash("sha256").update(item.text).digest("hex").slice(0, 16);
        const key = `${store.dir}:${item.chapter}`;
        const cached = vectorCache.get(key);
        if (cached && cached.hash === hash) vectors[index] = cached.vector;
        else pending.push({ index, text: item.text });
      });
      if (pending.length) {
        const embedded = await embedTexts(embedding, pending.map((item) => item.text));
        pending.forEach((item, offset) => {
          const vector = embedded[offset]!;
          const chapter = corpus[item.index]!.chapter;
          const hash = createHash("sha256").update(item.text).digest("hex").slice(0, 16);
          vectorCache.set(`${store.dir}:${chapter}`, { hash, vector });
          vectors[item.index] = vector;
        });
      }
      const [queryVector] = await embedTexts(embedding, [query]);
      const hits = corpus
        .map((item, index) => ({ id: item.chapter, score: Math.round(cosineSimilarity(queryVector!, vectors[index]!) * 1000) / 1000 }))
        .filter((hit) => hit.score > 0)
        .sort((a, b) => b.score - a.score || a.id - b.id)
        .slice(0, 3);
      if (hits.length) return { related_chapters: decorate(hits), engine: "embedding" };
    } catch { /* 嵌入失败回落 BM25 */ }
  }
  const docs: Bm25Doc[] = corpus.map((item) => ({ id: item.chapter, text: item.text }));
  const hits = bm25Search(docs, query, 3);
  if (!hits.length) return {};
  return { related_chapters: decorate(hits), engine: "bm25" };
}
function defaultRunMeta(): RunMeta { return { started_at: new Date().toISOString(), provider: "", style: "", model: "", planning_tier: "mid", steer_history: [], pending_steer: "", pause_point: null }; }
async function saveRunMeta(store: ToolRegistryOptions["store"], patch: Partial<RunMeta>) { const current = await store.runMeta.load() as RunMeta | null; await store.runMeta.save({ ...defaultRunMeta(), ...current, ...patch }); }
