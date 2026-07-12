import type { z } from "zod";
import type { Store } from "../store/index.js";
import { createTools } from "./tools.js";

export interface AskUserResponse { answers: Record<string, string>; notes?: Record<string, string>; }
export type AskUserHandler = (questions: Array<{ question: string; header: string; options: Array<{ label: string; description: string }>; multiSelect?: boolean }>) => Promise<AskUserResponse>;
export interface ToolRegistryOptions { store: Store; askUser?: AskUserHandler; }
export interface RegisteredTool<T extends z.ZodTypeAny = z.ZodTypeAny> {
  description: string;
  inputSchema: T;
  execute: (input: z.infer<T>, context?: unknown) => Promise<unknown>;
}

export function createToolRegistry(options: ToolRegistryOptions) {
  const registry = createTools(options);
  return { ...registry, read_draft: registry.read_chapter };
}

export type ToolRegistry = ReturnType<typeof createToolRegistry>;
