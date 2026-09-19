import { EvolutionFileSchema, type EvolutionFile } from "../domain/evolution.js";
import { FileIO } from "./io.js";
export class EvolutionStore {
  constructor(private readonly io: FileIO) {}
  async load(): Promise<EvolutionFile> { const raw = await this.io.readJSON<unknown>("meta/evolution.json"); const parsed = raw ? EvolutionFileSchema.safeParse(raw) : null; return parsed?.success ? parsed.data : { lessons: [], chapterScores: [], updatedAt: new Date().toISOString() }; }
  save(file: EvolutionFile) { return this.io.writeJSON("meta/evolution.json", EvolutionFileSchema.parse({ ...file, updatedAt: new Date().toISOString() })); }
}
