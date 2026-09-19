import { FileIO } from "./io.js";
import { BUILTIN_SKILL_PACKS, emptySkillPackFile, SKILLPACKS_PATH, SkillPackFileSchema, SkillPackSchema, type SkillPack, type SkillPackFile } from "../domain/skillpack.js";

/**
 * 技能包状态存储（P7-3）。
 * enabled 为启用的包 id 列表（内置 + 自定义共用），custom 为用户自建包。
 */

export class SkillPackStore {
  constructor(private readonly io: FileIO) {}

  async load(): Promise<SkillPackFile> {
    const data = await this.io.readJSON<SkillPackFile>(SKILLPACKS_PATH);
    if (!data) return emptySkillPackFile();
    const parsed = SkillPackFileSchema.safeParse(data);
    return parsed.success ? parsed.data : emptySkillPackFile();
  }

  async save(file: SkillPackFile): Promise<void> {
    const parsed = SkillPackFileSchema.parse(file);
    await this.io.writeJSON(SKILLPACKS_PATH, { ...parsed, updatedAt: new Date().toISOString() });
  }

  async toggle(id: string, enabled: boolean): Promise<SkillPackFile> {
    const file = await this.load();
    const exists = [...BUILTIN_SKILL_PACKS, ...file.custom].some((pack) => pack.id === id);
    if (!exists) throw new Error(`技能包不存在: ${id}`);
    const next = new Set(file.enabled);
    if (enabled) next.add(id);
    else next.delete(id);
    const updated = { ...file, enabled: [...next] };
    await this.save(updated);
    return updated;
  }

  async appendCustom(pack: SkillPack): Promise<SkillPackFile> {
    const parsed = SkillPackSchema.parse({ ...pack, origin: "custom" });
    const file = await this.load();
    if (file.custom.some((item) => item.id === parsed.id)) throw new Error(`技能包 id 重复: ${parsed.id}`);
    const updated = { ...file, custom: [...file.custom, parsed] };
    await this.save(updated);
    return updated;
  }

  async removeCustom(id: string): Promise<boolean> {
    const file = await this.load();
    const next = file.custom.filter((pack) => pack.id !== id);
    if (next.length === file.custom.length) return false;
    await this.save({ ...file, custom: next, enabled: file.enabled.filter((item) => item !== id) });
    return true;
  }
}
