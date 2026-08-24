import type { z } from "zod";
import type { Store } from "../store/index.js";
import { createTools } from "./tools.js";
import type { Candidate } from "../rules/index.js";
import type { Agent } from "../agents/agent.js";

export interface AskUserResponse { answers: Record<string, string>; notes?: Record<string, string>; }
export type AskUserHandler = (questions: Array<{ question: string; header: string; options: Array<{ label: string; description: string }>; multiSelect?: boolean }>) => Promise<AskUserResponse>;
export interface ToolRegistryOptions {
  store: Store;
  askUser?: AskUserHandler;
  references?: Record<string, string>;
  /** 运行时规则归一化（LLM）。缺省时 save_user_rules 降级为原文保存。 */
  normalize?: (text: string) => Promise<Candidate>;
  /** 子代理查找器（晚绑定：registry 在 agents 创建前装配）。缺省时 subagent 工具不可用。 */
  subagents?: () => Record<string, Agent>;
}
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
