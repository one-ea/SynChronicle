import { CastEntrySchema, type CastEntry, type CastIntro } from "../domain/index.js";
import { FileIO } from "./io.js";

export class CastStore {
  constructor(private readonly io: FileIO) {}
  async load() { return await this.io.readJSON("meta/cast_ledger.json", CastEntrySchema.array()) ?? []; }
  save(entries: CastEntry[]) { CastEntrySchema.array().parse(entries); return this.io.writeJSON("meta/cast_ledger.json", entries); }
  async mergeAppearances(chapter: number, characters: string[], intros: CastIntro[] = [], knownCore: Record<string, boolean> = {}) { if (chapter <= 0 || !characters.length) return; const entries = await this.load(); const intro = new Map(intros.map((item) => [item.name, item.brief_role])); const index = new Map<string, number>(); entries.forEach((entry, i) => { index.set(entry.name, i); entry.aliases?.forEach((alias) => index.set(alias, i)); }); for (const name of new Set(characters.filter(Boolean))) { if (knownCore[name]) continue; const i = index.get(name); if (i !== undefined) { const entry = entries[i]!; if (!entry.appearance_chapters.includes(chapter)) { entry.appearance_chapters.push(chapter); entry.appearance_count = entry.appearance_chapters.length; entry.first_seen_chapter = Math.min(entry.first_seen_chapter || chapter, chapter); entry.last_seen_chapter = Math.max(entry.last_seen_chapter, chapter); } if (!entry.brief_role && intro.get(name)) entry.brief_role = intro.get(name); } else entries.push({ name, brief_role: intro.get(name) || "", first_seen_chapter: chapter, last_seen_chapter: chapter, appearance_count: 1, appearance_chapters: [chapter] }); } await this.save(entries); }
  async recentActive(limit: number) { if (limit <= 0) return []; return (await this.load()).filter((entry) => !entry.promoted).sort((a, b) => b.last_seen_chapter - a.last_seen_chapter || b.appearance_count - a.appearance_count).slice(0, limit); }
}
