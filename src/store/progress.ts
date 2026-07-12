import { ProgressSchema, type FlowState, type Phase, type Progress } from "../domain/index.js";
import { FileIO } from "./io.js";

export class ProgressStore {
  constructor(private readonly io: FileIO) {}
  load() { return this.io.readJSON("meta/progress.json", ProgressSchema); }
  save(progress: Progress) { return this.io.writeJSON("meta/progress.json", progress); }
  async init(novelName: string, totalChapters: number) {
    await this.save({ novel_name: novelName, phase: "init", total_chapters: totalChapters, current_chapter: 0, completed_chapters: [], total_word_count: 0, flow: "writing", in_progress_chapter: 0, completed_scenes: [], chapter_word_counts: {}, hook_history: [], strand_history: [], layered: false, current_volume: 0, current_arc: 0, pending_rewrites: [], rewrite_reason: "", reopened_from_complete: false });
  }
  private async update(fn: (progress: MutableProgress) => void) { const progress = (await this.load() ?? emptyProgress()) as MutableProgress; fn(progress); await this.save(progress); }
  setTotalChapters(total_chapters: number) { return this.update((p) => { p.total_chapters = total_chapters; }); }
  setNovelName(name: string) { const value = name.trim(); return value ? this.update((p) => { p.novel_name = value; }) : Promise.resolve(); }
  updatePhase(phase: Phase) { return this.update((p) => { validatePhaseTransition(p.phase, phase); p.phase = phase; }); }
  startChapter(chapter: number) { if (chapter <= 0) throw new Error("chapter must be > 0"); return this.update((p) => { p.phase = "writing"; if (p.flow !== "rewriting" && p.flow !== "polishing") p.flow = "writing"; p.current_chapter = Math.max(p.current_chapter, chapter); p.in_progress_chapter = chapter; p.completed_scenes = []; }); }
  async isChapterCompleted(chapter: number) { return (await this.load())?.completed_chapters.includes(chapter) ?? false; }
  markChapterComplete(chapter: number, wordCount: number, hookType: string, dominantStrand: string) { return this.update((p) => { const old = p.chapter_word_counts[String(chapter)] ?? 0; p.chapter_word_counts[String(chapter)] = wordCount; p.total_word_count += wordCount - old; if (!p.completed_chapters.includes(chapter)) p.completed_chapters.push(chapter); p.current_chapter = Math.max(p.current_chapter, chapter + 1); p.in_progress_chapter = 0; p.completed_scenes = []; p.phase = "writing"; setHistory(p.strand_history, chapter, dominantStrand); setHistory(p.hook_history, chapter, hookType); }); }
  markComplete() { return this.update((p) => { p.phase = "complete"; p.reopened_from_complete = false; }); }
  clearInProgress() { return this.update((p) => { p.in_progress_chapter = 0; p.completed_scenes = []; }); }
  updateVolumeArc(volume: number, arc: number) { return this.update((p) => { p.current_volume = volume; p.current_arc = arc; }); }
  setLayered(layered: boolean) { return this.update((p) => { p.layered = layered; }); }
  setFlow(flow: FlowState) { return this.update((p) => { validateFlowTransition(p.flow, flow); p.flow = flow; }); }
  async setPendingRewrites(chapters: number[], reason: string) { const p = await this.load(); if (!p) return; p.pending_rewrites = normalizeRewrites(chapters, p.completed_chapters); p.rewrite_reason = reason; await this.save(p); }
  async validateChapterWork(chapter: number) { const p = await this.load(); if (!p || !p.flow || !["rewriting", "polishing"].includes(p.flow)) return; const pending = p.pending_rewrites ?? []; normalizeRewrites(pending, p.completed_chapters); if (!pending.includes(chapter)) throw new Error(`第 ${chapter} 章不在待处理队列中`); }
  completeRewrite(chapter: number) { return this.update((p) => { p.pending_rewrites = p.pending_rewrites.filter((item) => item !== chapter); if (!p.pending_rewrites.length) { p.flow = "writing"; p.rewrite_reason = ""; } }); }
}

type MutableProgress = Progress & Required<Pick<Progress, "chapter_word_counts" | "in_progress_chapter" | "completed_scenes" | "flow" | "pending_rewrites" | "rewrite_reason" | "strand_history" | "hook_history" | "current_volume" | "current_arc" | "layered" | "reopened_from_complete">>;
const emptyProgress = (): MutableProgress => ({ novel_name: "", phase: "init", total_chapters: 0, current_chapter: 0, completed_chapters: [], total_word_count: 0, flow: "writing", in_progress_chapter: 0, completed_scenes: [], chapter_word_counts: {}, hook_history: [], strand_history: [], layered: false, current_volume: 0, current_arc: 0, pending_rewrites: [], rewrite_reason: "", reopened_from_complete: false });
function setHistory(history: string[], chapter: number, value: string) { if (!value) return; while (history.length < chapter) history.push(""); history[chapter - 1] = value; }
function normalizeRewrites(chapters: number[], completed: number[]) { const set = new Set(completed); const invalid = chapters.filter((chapter) => chapter <= 0 || !set.has(chapter)); if (invalid.length) throw new Error(`pending_rewrites 只能包含已完成章节，非法章节：${invalid}`); return [...new Set(chapters)]; }
function validatePhaseTransition(from: Phase, to: Phase) { const order = ["init", "premise", "outline", "writing", "reviewing", "complete"]; if (order.indexOf(to) < order.indexOf(from)) throw new Error(`invalid phase transition: ${from} -> ${to}`); }
function validateFlowTransition(from: FlowState, to: FlowState) { if (from === "rewriting" && to === "reviewing") throw new Error(`invalid flow transition: ${from} -> ${to}`); }
