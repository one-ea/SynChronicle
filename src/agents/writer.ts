import type { LanguageModel } from "ai";
import type { RegisteredTool, ToolRegistry } from "../tools/registry.js";
import { createAgent, type AgentOptions } from "./agent.js";

type LanguageModelInstance = Exclude<LanguageModel, string>;

const writerTools = ["novel_context", "read_chapter", "plan_chapter", "draft_chapter", "edit_chapter", "check_consistency", "commit_chapter"] as const;

export function createWriter(model: LanguageModelInstance, system: string, registry: ToolRegistry, options: Omit<AgentOptions, "name" | "model" | "system" | "tools"> = {}) {
  const tools = Object.fromEntries(writerTools.map((name) => [name, registry[name] as RegisteredTool<any>]));
  return createAgent({ ...options, name: "writer", model, system, tools });
}
