import { WorldRuleSchema, type WorldRule } from "../domain/index.js";
import { FileIO } from "./io.js";

export class WorldStore {
  constructor(private readonly io: FileIO) {}
  async saveWorldRules(rules: WorldRule[]) { WorldRuleSchema.array().parse(rules); await this.io.writeJSON("world_rules.json", rules); await this.io.writeFile("world_rules.md", render(rules)); }
  async loadWorldRules() { return await this.io.readJSON("world_rules.json", WorldRuleSchema.array()) ?? []; }
}
function render(rules: WorldRule[]) { const groups = new Map<string, WorldRule[]>(); for (const rule of rules) { const category = rule.category || "other"; groups.set(category, [...(groups.get(category) ?? []), rule]); } return `# 世界观规则\n\n${[...groups].map(([category, values]) => `## ${category}\n\n${values.map((value) => `- **规则**：${value.rule}\n${value.boundary ? `  - 边界：${value.boundary}\n` : ""}`).join("")}\n`).join("")}`; }
