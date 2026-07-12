import type { LanguageModel } from "ai";
import type { RegisteredTool, ToolRegistry } from "../tools/registry.js";
import { createAgent, type AgentOptions } from "./agent.js";

type LanguageModelInstance = Exclude<LanguageModel, string>;

const coordinatorTools = ["novel_context", "save_user_rules", "reopen_book", "save_pause_point", "ask_user"] as const;

export function createCoordinator(model: LanguageModelInstance, system: string, registry: ToolRegistry, options: Omit<AgentOptions, "name" | "model" | "system" | "tools"> = {}) {
  const tools = Object.fromEntries(coordinatorTools.map((name) => [name, registry[name] as RegisteredTool<any>]));
  return createAgent({ ...options, name: "coordinator", model, system, tools });
}
