import { CharacterSchema, OutlineEntrySchema, StoryCompassSchema, VolumeOutlineSchema, type Character, type OutlineEntry, type StoryCompass, type VolumeOutline } from "../domain/index.js";
import { FileIO } from "./io.js";

export class OutlineStore {
  constructor(private readonly io: FileIO) {}
  savePremise(content: string) { return this.io.writeFile("premise.md", content); }
  loadPremise() { return this.io.readText("premise.md"); }
  async saveOutline(entries: OutlineEntry[]) { await this.io.writeJSON("outline.json", entries); await this.io.writeFile("outline.md", renderOutline(entries)); }
  async loadOutline() { return await this.io.readJSON("outline.json", OutlineEntrySchema.array()) ?? []; }
  async getChapterOutline(chapter: number) { const entry = (await this.loadOutline()).find((item) => item.chapter === chapter); if (!entry) throw new Error(`chapter ${chapter} not found in outline`); return entry; }
  async saveLayeredOutline(volumes: VolumeOutline[]) { await this.io.writeJSON("layered_outline.json", volumes); await this.io.writeFile("layered_outline.md", renderLayered(volumes)); }
  async loadLayeredOutline() { return await this.io.readJSON("layered_outline.json", VolumeOutlineSchema.array()) ?? []; }
  async clearLayeredOutline() { await this.io.remove("layered_outline.json"); await this.io.remove("layered_outline.md"); }
  async saveCompass(compass: StoryCompass) { if (!compass.ending_direction) throw new Error("ending_direction 不能为空"); StoryCompassSchema.parse(compass); await this.io.writeJSON("meta/compass.json", compass); }
  loadCompass() { return this.io.readJSON("meta/compass.json", StoryCompassSchema); }
}

export class CharacterStore {
  constructor(private readonly io: FileIO) {}
  async save(characters: Character[]) { CharacterSchema.array().parse(characters); await this.io.writeJSON("characters.json", characters); await this.io.writeFile("characters.md", renderCharacters(characters)); }
  async load() { return await this.io.readJSON("characters.json", CharacterSchema.array()) ?? []; }
  saveSnapshots(volume: number, arc: number, value: unknown) { return this.io.writeJSON(`meta/snapshots/v${pad(volume)}a${pad(arc)}.json`, value); }
}

const pad = (value: number) => String(value).padStart(2, "0");
function renderOutline(entries: OutlineEntry[]) { return `# 大纲\n\n${entries.map((entry) => `## 第 ${entry.chapter} 章：${entry.title}\n\n**核心事件**：${entry.core_event}\n\n${entry.hook ? `**钩子**：${entry.hook}\n\n` : ""}`).join("")}`; }
function renderLayered(volumes: VolumeOutline[]) { let chapter = 1; return `# 分层大纲\n\n${volumes.map((volume) => `## 第 ${volume.index} 卷：${volume.title}\n\n**主题**：${volume.theme}\n\n${volume.arcs.map((arc) => `### 第 ${arc.index} 弧：${arc.title}\n\n**目标**：${arc.goal}\n\n${arc.chapters?.map((entry) => `#### 第 ${chapter++} 章：${entry.title}\n\n**核心事件**：${entry.core_event}\n\n`).join("") ?? `*（待展开，预估 ${arc.estimated_chapters ?? 0} 章）*\n\n`}`).join("")}`).join("")}`; }
function renderCharacters(characters: Character[]) { return `# 角色档案\n\n${characters.map((character) => `## ${character.name}（${character.role}）\n\n${character.description}\n\n${character.arc ? `**角色弧线**：${character.arc}\n\n` : ""}${character.traits.length ? `**特征**：${character.traits.join("、")}\n\n` : ""}`).join("")}`; }
