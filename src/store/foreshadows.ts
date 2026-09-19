import { ForeshadowFileSchema, type ForeshadowFile, type ForeshadowTrack } from "../domain/foreshadow.js";
import { FileIO } from "./io.js";

/**
 * 结构化伏笔存储（specs/2026-09-19-p6-consistency-and-platform R4）。
 * 八类型伏笔线索持久化，进入 recall 语料与终章门禁诊断。
 */

const FORESHADOWS_PATH = "meta/foreshadows.json";

export class ForeshadowStore {
  constructor(private readonly io: FileIO) {}

  async load(): Promise<ForeshadowFile> {
    const data = await this.io.readJSON<ForeshadowFile>(FORESHADOWS_PATH);
    if (!data) return { items: [], updatedAt: new Date().toISOString() };
    const parsed = ForeshadowFileSchema.safeParse(data);
    return parsed.success ? parsed.data : { items: [], updatedAt: new Date().toISOString() };
  }

  async save(file: ForeshadowFile): Promise<void> {
    const parsed = ForeshadowFileSchema.parse(file);
    await this.io.writeJSON(FORESHADOWS_PATH, { ...parsed, updatedAt: new Date().toISOString() });
  }

  async upsert(track: ForeshadowTrack): Promise<void> {
    const file = await this.load();
    const index = file.items.findIndex((item) => item.id === track.id);
    if (index >= 0) file.items[index] = track;
    else file.items.push(track);
    await this.save(file);
  }

  async remove(id: string): Promise<boolean> {
    const file = await this.load();
    const next = file.items.filter((item) => item.id !== id);
    if (next.length === file.items.length) return false;
    await this.save({ ...file, items: next });
    return true;
  }
}
