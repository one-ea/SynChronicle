import { FileIO } from "./io.js";
import { PrepSessionSchema, type PrepSession } from "../domain/prep.js";

export class PrepStore {
  constructor(private readonly io: FileIO) {}
  async save(session: PrepSession): Promise<void> { await this.io.writeJSON(`meta/prep/${session.id}.json`, session); }
  async load(id: string): Promise<PrepSession | null> {
    const raw = await this.io.readJSON<unknown>(`meta/prep/${id}.json`);
    if (!raw) return null;
    const parsed = PrepSessionSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }
  async list(): Promise<PrepSession[]> {
    const names = await this.io.listDir("meta/prep").catch(() => []);
    const sessions: PrepSession[] = [];
    for (const name of names.filter((item) => item.endsWith(".json"))) {
      const session = await this.load(name.slice(0, -5));
      if (session) sessions.push(session);
    }
    return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
}
