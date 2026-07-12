import type { LanguageModel } from "ai";
import type { RegisteredTool, ToolRegistry } from "../tools/registry.js";
import { createAgent, type AgentOptions } from "./agent.js";

type LanguageModelInstance = Exclude<LanguageModel, string>;

const editorTools = ["novel_context", "read_chapter", "save_review", "save_arc_summary", "save_volume_summary"] as const;

export function createEditor(model: LanguageModelInstance, system: string, registry: ToolRegistry, options: Omit<AgentOptions, "name" | "model" | "system" | "tools"> = {}) {
  const tools = Object.fromEntries(editorTools.map((name) => [name, registry[name] as RegisteredTool<any>]));
  return createAgent({ ...options, name: "editor", model, system, tools });
}
