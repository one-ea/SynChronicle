import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface AssetBundle { references: Record<string, string>; prompts: Record<string, string>; styles: Record<string, string> }
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "assets");
const cache = new Map<string, AssetBundle>();
const promptRoles: Record<string, string> = { "coordinator.md": "coordinator", "architect-short.md": "architect", "architect-long.md": "architect", "writer.md": "writer", "editor.md": "editor" };
const guidance = "## 仿写画像\n\n当 novel_context 返回 simulation_profile 时，{{role}} 必须把它视为当前作品的仿写方向约束。借鉴结构、节奏和钩子，不复制原文专有内容。";
const read = (...parts: string[]) => readFileSync(join(root, ...parts), "utf8");
const key = (name: string) => name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()).replace(/\.md$/, "");
export const withSimulationGuidance = (prompt: string, role: string) => `${prompt}\n\n${guidance.replaceAll("{{role}}", role)}`;

export function loadAssets(style = "default"): AssetBundle {
  const selected = style || "default";
  const cached = cache.get(selected); if (cached) return cached;
  const prompts: Record<string, string> = {};
  for (const file of readdirSync(join(root, "prompts")).filter(x => x.endsWith(".md"))) {
    const raw = read("prompts", file); const role = promptRoles[file];
    prompts[key(file)] = role ? withSimulationGuidance(raw, role) : raw;
  }
  const references: Record<string, string> = {};
  for (const file of readdirSync(join(root, "references")).filter(x => x.endsWith(".md"))) references[key(file)] = read("references", file);
  if (selected !== "default") {
    try { references.styleReference = read("references", "genres", selected, "style-references.md"); } catch { /* optional */ }
    try { references.arcTemplates = read("references", "genres", selected, "arc-templates.md"); } catch { /* optional */ }
  }
  const styles = Object.fromEntries(readdirSync(join(root, "styles")).filter(x => x.endsWith(".md")).map(file => [key(file), read("styles", file)]));
  const bundle = { references, prompts, styles }; cache.set(selected, bundle); return bundle;
}

export function overridePrompt(bundle: AssetBundle, file: string, raw: string): void {
  const role = promptRoles[file]; if (!role) throw new Error(`不支持覆盖的 prompt 文件: ${file}`);
  bundle.prompts[key(file)] = withSimulationGuidance(raw, role);
}
