import { ChapterPlanSchema, type ChapterPlan } from "../domain/index.js";
import { FileIO } from "./io.js";

const pad = (value: number) => String(value).padStart(2, "0");
export class DraftStore {
  constructor(private readonly io: FileIO) {}
  async saveChapterPlan(plan: ChapterPlan) { ChapterPlanSchema.parse(plan); await this.io.writeJSON(`drafts/${pad(plan.chapter)}.plan.json`, plan); }
  loadChapterPlan(chapter: number) { return this.io.readJSON(`drafts/${pad(chapter)}.plan.json`, ChapterPlanSchema); }
  saveDraft(chapter: number, content: string) { return this.io.writeFile(`drafts/${pad(chapter)}.draft.md`, content); }
  async appendDraft(chapter: number, content: string) { const current = await this.loadDraft(chapter); await this.saveDraft(chapter, current ? `${current}\n\n${content}` : content); }
  loadDraft(chapter: number) { return this.io.readText(`drafts/${pad(chapter)}.draft.md`); }
  saveFinalChapter(chapter: number, content: string) { return this.io.writeFile(`chapters/${pad(chapter)}.md`, content); }
  loadChapterText(chapter: number) { return this.io.readText(`chapters/${pad(chapter)}.md`); }
  async loadChapterRange(from: number, to: number, maxCharacters = 0) { const result: Record<number, string> = {}; for (let chapter = from; chapter <= to; chapter++) { let text = await this.loadChapterText(chapter); if (!text) continue; const chars = [...text]; if (maxCharacters > 0 && chars.length > maxCharacters) text = `${chars.slice(0, maxCharacters).join("")}...`; result[chapter] = text; } return result; }
}
