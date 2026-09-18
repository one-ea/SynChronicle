import { EntitiesFileSchema, type Entity, type EntitiesFile, type EntityRelation } from "../domain/entity.js";
import { FileIO } from "./io.js";

const ENTITIES_PATH = "meta/entities.json";

export class EntityStore {
  constructor(private readonly io: FileIO) {}

  async load(): Promise<EntitiesFile> {
    const data = await this.io.readJSON<EntitiesFile>(ENTITIES_PATH);
    if (!data) return { entities: [], updatedAt: new Date().toISOString() };
    const parsed = EntitiesFileSchema.safeParse(data);
    return parsed.success ? parsed.data : { entities: [], updatedAt: new Date().toISOString() };
  }

  async save(file: EntitiesFile): Promise<void> {
    const payload = {
      ...file,
      updatedAt: new Date().toISOString(),
    };
    EntitiesFileSchema.parse(payload);
    await this.io.writeJSON(ENTITIES_PATH, payload);
  }

  async getEntity(id: string): Promise<Entity | undefined> {
    const file = await this.load();
    return file.entities.find((e) => e.id === id || e.name === id || e.aliases.includes(id));
  }

  async upsertEntity(entity: Entity): Promise<void> {
    const file = await this.load();
    const index = file.entities.findIndex((e) => e.id === entity.id);
    if (index >= 0) {
      // 增量合并别名与关系
      const existing = file.entities[index]!;
      const aliases = [...new Set([...existing.aliases, ...entity.aliases])];
      file.entities[index] = {
        ...existing,
        ...entity,
        aliases,
        relations: mergeRelations(existing.relations, entity.relations),
        states: [...existing.states, ...entity.states],
      };
    } else {
      file.entities.push(entity);
    }
    await this.save(file);
  }

  async linkRelation(sourceId: string, relation: EntityRelation): Promise<void> {
    const file = await this.load();
    const source = file.entities.find((e) => e.id === sourceId);
    if (!source) throw new Error(`源实体未找到: ${sourceId}`);
    source.relations = mergeRelations(source.relations, [relation]);
    await this.save(file);
  }
}

function mergeRelations(existing: EntityRelation[], incoming: EntityRelation[]): EntityRelation[] {
  const map = new Map<string, EntityRelation>();
  for (const r of existing) map.set(`${r.targetId}:${r.type}`, r);
  for (const r of incoming) map.set(`${r.targetId}:${r.type}`, r);
  return Array.from(map.values());
}
