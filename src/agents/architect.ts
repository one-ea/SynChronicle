import type { LanguageModel } from "ai";
import type { RegisteredTool, ToolRegistry } from "../tools/registry.js";
import { createAgent, type AgentOptions } from "./agent.js";

type LanguageModelInstance = Exclude<LanguageModel, string>;

export function createArchitect(name: "architect_short" | "architect_long", model: LanguageModelInstance, system: string, registry: ToolRegistry, options: Omit<AgentOptions, "name" | "model" | "system" | "tools"> = {}) {
  const tools = Object.fromEntries((["novel_context", "save_foundation"] as const).map((toolName) => [toolName, registry[toolName] as RegisteredTool<any>]));
  return createAgent({ ...options, name, model, system, tools });
}
