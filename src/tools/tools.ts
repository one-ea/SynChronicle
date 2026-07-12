import { join } from "node:path";
import { z } from "zod";
import type { OutlineEntry, Progress, ReviewEntry, RunMeta, VolumeOutline } from "../domain/index.js";
import type { RegisteredTool, ToolRegistryOptions } from "./registry.js";

const positiveInt = z.number().int().positive();
const strings = z.array(z.string());
const chapterScope = (chapter: number) => ({ kind: "chapter" as const, chapter });
const pad = (value: number) => String(value).padStart(2, "0");

function registered<T extends z.ZodTypeAny>(description: string, inputSchema: T, execute: RegisteredTool<T>["execute"]): RegisteredTool<T> {
  return { description, inputSchema, execute: async (input, context) => execute(inputSchema.parse(input), context) };
}

export function createTools({ store, askUser }: ToolRegistryOptions) {
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

  const tools = {
    novel_context: registered("获取小说当前状态和创作上下文", novelContextSchema, async ({ chapter, consumer }) => {
      const resolvedConsumer = consumer ?? (chapter ? "writer" : "architect");
      if ((resolvedConsumer === "writer" || resolvedConsumer === "editor") && !chapter) throw new Error(`chapter must be > 0 for consumer ${resolvedConsumer}`);
      const progress = await store.progress.load();
      const working = { user_rules: await store.userRules.load() ?? {} };
      if (resolvedConsumer === "coordinator") return { progress_status: progressStatus(progress), foundation_status: await store.foundationMissing(), working_memory: working };
      if (resolvedConsumer === "architect") return { progress_status: progressStatus(progress), planning_memory: { outline: await store.outline.loadOutline() }, foundation_memory: await foundation(store), reference_pack: {}, working_memory: working };
      return { working_memory: { ...working, chapter_plan: await store.drafts.loadChapterPlan(chapter!) }, episodic_memory: {}, reference_pack: {}, ...(resolvedConsumer === "writer" ? { selected_memory: {} } : {}) };
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
      const content = await store.drafts.loadDraft(chapter) || await store.drafts.loadChapterText(chapter); if (!content) throw new Error(`no content found for chapter ${chapter}`);
      await store.drafts.saveFinalChapter(chapter, content); await store.summaries.saveSummary({ chapter, summary, characters, key_events });
      const known = Object.fromEntries((await store.characters.load()).map((character) => [character.name, true])); await store.cast.mergeAppearances(chapter, characters, [], known);
      if (await store.progress.isChapterCompleted(chapter)) await store.progress.completeRewrite(chapter); else await store.progress.markChapterComplete(chapter, [...content].length, hook_type, dominant_strand);
      await store.checkpoints.appendArtifact(chapterScope(chapter), "commit", `chapters/${pad(chapter)}.md`); return { committed: true, chapter, word_count: [...content].length };
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
      const review: ReviewEntry = { ...input, dimensions, affected_chapters: affected }; await writeJSON(store.dir, `reviews/${pad(input.chapter)}${input.scope === "global" ? "-global" : ""}.json`, review);
      await store.checkpoints.appendArtifact(chapterScope(input.chapter), "review", `reviews/${pad(input.chapter)}${input.scope === "global" ? "-global" : ""}.json`); return { saved: true, chapter: input.chapter, final_verdict: verdict, affected_chapters: affected };
    }),
    save_arc_summary: registered("保存弧级摘要和角色快照", saveArcSummarySchema, async ({ character_snapshots, style_rules, ...summary }) => {
      await store.summaries.saveArcSummary(summary); if (character_snapshots.length) await store.characters.saveSnapshots(summary.volume, summary.arc, character_snapshots.map((item) => ({ ...item, volume: summary.volume, arc: summary.arc })));
      if (style_rules) await writeJSON(store.dir, "meta/style_rules.json", { volume: summary.volume, arc: summary.arc, ...style_rules, taboos: style_rules.taboos ?? [], updated_at: new Date().toISOString() });
      await store.checkpoints.appendArtifact({ kind: "arc", volume: summary.volume, arc: summary.arc }, "arc_summary", `summaries/arc-v${pad(summary.volume)}a${pad(summary.arc)}.json`); return { saved: true, type: "arc_summary", volume: summary.volume, arc: summary.arc };
    }),
    save_volume_summary: registered("保存卷级摘要", saveVolumeSummarySchema, async (summary) => { await store.summaries.saveVolumeSummary(summary); await store.checkpoints.appendArtifact({ kind: "volume", volume: summary.volume }, "volume_summary", `summaries/vol-v${pad(summary.volume)}.json`); return { saved: true, type: "volume_summary", volume: summary.volume }; }),
    save_pause_point: registered("登记用户验收停靠点", savePausePointSchema, async ({ after, reason, cancel }) => {
      const current = await store.runMeta.load() as RunMeta | null; if (cancel) { await store.runMeta.save({ ...defaultRunMeta(), ...current, pause_point: null }); return { pause_point_cleared: Boolean(current?.pause_point) }; }
      if (after !== "rewrites_drained") throw new Error('after 仅支持 "rewrites_drained"'); if ((await store.progress.load())?.phase !== "writing") throw new Error("停靠点仅在写作期可设");
      await store.runMeta.save({ ...defaultRunMeta(), ...current, pause_point: { after, reason, set_at: new Date().toISOString() } }); return { pause_point_set: true, after, reason };
    }),
    save_user_rules: registered("保存长效写作规则", saveUserRulesSchema, async ({ text }) => { const value = { status: "degraded", preferences: text }; await store.userRules.save(value); return { saved: true, status: "degraded", understood: { degraded: true, preferences: text }, in_effect: value }; }),
    ask_user: registered("向用户提出结构化问题", askUserSchema, async ({ questions }) => { if (!askUser) return "当前环境不支持交互式询问，请根据你的判断自行决策并继续。"; const response = await askUser(questions); const parts = questions.flatMap((question) => { const answer = response.answers[question.question]; if (!answer) return []; const note = response.notes?.[question.question]; return [`[${question.header}] ${answer}${note ? `（补充：${note}）` : ""}`]; }); return parts.length ? `用户回答：${parts.join("；")}` : "用户未提供回答，请根据你的判断自行决策并继续。"; }),
    reopen_book: registered("把已完结的书重新打开进入返工态", reopenBookSchema, async ({ chapters, reason }) => {
      const progress = await store.progress.load(); if (!progress || progress.phase !== "complete") throw new Error("reopen_book 仅支持已完结小说"); if (chapters.some((chapter) => !progress.completed_chapters.includes(chapter))) throw new Error("reopen 只能返工已完成章节");
      await store.progress.save({ ...progress, phase: "writing", flow: "rewriting", pending_rewrites: chapters, rewrite_reason: reason, reopened_from_complete: true }); await store.checkpoints.appendArtifact({ kind: "global" }, "reopen", "meta/progress.json"); return { reopened: true, phase: "writing", pending_rewrites: chapters };
    }),
  };
  return tools;
}

function parseContent<T>(content: unknown): T { return (typeof content === "string" ? JSON.parse(content) : content) as T; }
function foundationArtifact(type: string) { return ({ outline: "outline.json", layered_outline: "layered_outline.json", characters: "characters.json", world_rules: "world_rules.json", update_compass: "meta/compass.json" } as Record<string, string>)[type] ?? "meta/progress.json"; }
function progressStatus(progress: Progress | null) { return progress ? { phase: progress.phase, flow: progress.flow ?? "writing", completed_chapters: progress.completed_chapters.length, total_chapters: progress.total_chapters, next_chapter: Math.max(1, ...progress.completed_chapters.map((chapter) => chapter + 1)), total_word_count: progress.total_word_count, pending_rewrites: progress.pending_rewrites ?? [] } : null; }
async function foundation(store: ToolRegistryOptions["store"]) { return { premise: await store.outline.loadPremise(), outline: await store.outline.loadOutline(), characters: await store.characters.load(), world_rules: await store.world.loadWorldRules() }; }
function defaultRunMeta(): RunMeta { return { started_at: new Date().toISOString(), provider: "", style: "", model: "", planning_tier: "mid", steer_history: [], pending_steer: "", pause_point: null }; }
async function saveRunMeta(store: ToolRegistryOptions["store"], patch: Partial<RunMeta>) { const current = await store.runMeta.load() as RunMeta | null; await store.runMeta.save({ ...defaultRunMeta(), ...current, ...patch }); }
async function writeJSON(dir: string, path: string, value: unknown) { const { atomicWrite } = await import("../store/io.js"); await atomicWrite(join(dir, path), JSON.stringify(value, null, 2)); }
