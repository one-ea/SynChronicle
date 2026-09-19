import { z } from "zod";
import { FileIO } from "./io.js";

/**
 * 素材库（specs/2026-09-19-p5-creation-workbench R1）。
 * 手动/脑暴产出的可复用创作资产，单文件持久化，进入 recall 语料。
 */

export const MaterialTypeSchema = z.enum(["trope", "setting", "line", "other"]);
export type MaterialType = z.infer<typeof MaterialTypeSchema>;

export const MaterialSchema = z.object({
  id: z.string().min(1),
  type: MaterialTypeSchema,
  title: z.string().min(1),
  content: z.string().min(1),
  tags: z.array(z.string()).default([]),
  source: z.enum(["manual", "brainstorm"]).default("manual"),
  createdAt: z.string(),
});
export type Material = z.infer<typeof MaterialSchema>;

export const MaterialsFileSchema = z.object({ materials: z.array(MaterialSchema).default([]), updatedAt: z.string().optional() });
export type MaterialsFile = z.infer<typeof MaterialsFileSchema>;

const MATERIALS_PATH = "meta/materials.json";

export class MaterialStore {
  constructor(private readonly io: FileIO) {}

  async load(): Promise<MaterialsFile> {
    const data = await this.io.readJSON<MaterialsFile>(MATERIALS_PATH);
    if (!data) return { materials: [], updatedAt: new Date().toISOString() };
    const parsed = MaterialsFileSchema.safeParse(data);
    return parsed.success ? parsed.data : { materials: [], updatedAt: new Date().toISOString() };
  }

  async save(file: MaterialsFile): Promise<void> {
    const parsed = MaterialsFileSchema.parse(file);
    await this.io.writeJSON("meta/materials.json", { ...parsed, updatedAt: new Date().toISOString() });
  }

  async add(input: Omit<Material, "id" | "createdAt"> & { id?: string }): Promise<Material> {
    const file = await this.load();
    const material: Material = MaterialSchema.parse({
      ...input,
      id: input.id ?? `mt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      createdAt: new Date().toISOString(),
    });
    file.materials.push(material);
    await this.save(file);
    return material;
  }

  async remove(id: string): Promise<boolean> {
    const file = await this.load();
    const next = file.materials.filter((item) => item.id !== id);
    if (next.length === file.materials.length) return false;
    await this.save({ ...file, materials: next });
    return true;
  }
}
