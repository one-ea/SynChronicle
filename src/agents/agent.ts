import { generateText, stepCountIs, streamText, tool, type LanguageModel, type ModelMessage, type ToolSet } from "ai";
import type { RegisteredTool } from "../tools/registry.js";
import { ContextManager } from "./context.js";
import { usageModelIdentity } from "../providers/failover.js";

type LanguageModelInstance = Exclude<LanguageModel, string>;
export type GenerateResult = Awaited<ReturnType<typeof generateText>>;

export interface AgentExecutor {
  execute(
    task: { objective: string; constraints: string[] },
    generate: (prompt: string, signal?: AbortSignal) => Promise<GenerateResult>,
    signal?: AbortSignal,
  ): Promise<{ executionId?: string; output: GenerateResult; qualityRisk?: unknown; finalReview?: unknown; rounds?: number; stagedArtifactIds?: string[] }>;
}

export interface AgentOptions {
  name: string;
  model: LanguageModelInstance;
  system: string;
  tools?: Record<string, RegisteredTool<any>>;
  context?: ContextManager;
  maxSteps?: number;
  onUsage?: (name: string, usage: unknown, model?: { provider: string; model: string }) => void;
  executor?: AgentExecutor;
  /**
   * CheckpointDeltaGuard（对应 docs/architecture.md §6.4 设计愿景，TS 落地版）：
   * 本轮结束（finishReason=stop）时必须产生新的 checkpoint，否则注入 reminder 重试。
   * probe 返回当前 checkpoint 序号（如 checkpoints.all().length）；requireProgress 返回
   * false 可放行（默认 true）。连续 maxBlocked 次拦不住则放弃（按原型语义终止）。
   */
  stopGuard?: {
    probe: () => Promise<number>;
    requireProgress?: () => Promise<boolean>;
    maxBlocked?: number;
    reminder?: (attempt: number) => string;
  };
}

/** 停止守护拦截信号：generateText 内部抛出，由 generateDirect 捕获后追加 reminder 重试。 */
export class StopBlockedError extends Error {
  constructor() {
    super("stop blocked: no new checkpoint in this step");
    this.name = "StopBlockedError";
  }
}

const DEFAULT_REMINDER = "进度尚未推进：本轮结束前必须写入新的 checkpoint（plan/draft/commit/review/arc_summary 等）。请继续执行未完成的步骤，不要直接结束。";

export class Agent {
  readonly name: string;
  readonly context: ContextManager;
  private readonly model: LanguageModelInstance;
  private readonly system: string;
  private readonly tools: ToolSet;
  private readonly maxSteps: number;
  private readonly onUsage?: AgentOptions["onUsage"];
  private readonly executor?: AgentExecutor;
  private readonly stopGuard?: AgentOptions["stopGuard"];
  private readonly maxBlocked: number;
  private guardedMarked = false;
  private guardedBefore = 0;
  private lastReflection: { executionId?: string; status: "running" | "completed" | "failed"; qualityRisk?: unknown; finalReview?: unknown; rounds?: number } | null = null;
  private history: ModelMessage[] = [];
  private executionQueue: Promise<void> = Promise.resolve();

  constructor({ name, model, system, tools = {}, context = new ContextManager({ window: 200000 }), maxSteps = 20, onUsage, executor, stopGuard }: AgentOptions) {
    this.name = name;
    this.model = model;
    this.system = system;
    this.context = context;
    this.maxSteps = maxSteps;
    this.onUsage = onUsage;
    this.executor = executor;
    this.stopGuard = stopGuard;
    this.maxBlocked = Math.max(1, stopGuard?.maxBlocked ?? 3);
    this.tools = Object.fromEntries(Object.entries(tools).map(([toolName, definition]) => [toolName, tool({
      description: definition.description,
      inputSchema: definition.inputSchema,
      execute: async (input) => {
        if (stopGuard) this.guardedBefore = await stopGuard.probe();
        const output = await definition.execute(input);
        if (stopGuard && (await stopGuard.probe()) > this.guardedBefore) this.guardedMarked = true;
        return output;
      },
    })]));
  }

  messages(): readonly ModelMessage[] {
    return this.history.map((message) => structuredClone(message));
  }

  toolNames(): string[] {
    return Object.keys(this.tools);
  }

  clear(): void {
    this.history = [];
  }

  get reflectionEnabled(): boolean {
    return this.executor !== undefined;
  }

  reflectionMetadata() { return structuredClone(this.lastReflection); }

  generate(prompt: string, signal?: AbortSignal) {
    const operation = this.executionQueue.then(() => this.generateUnlocked(prompt, signal));
    this.executionQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async generateUnlocked(prompt: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (!this.executor) return this.generateDirect(prompt, signal);
    const baseline = structuredClone(this.history);
    this.lastReflection = { executionId: crypto.randomUUID(), status: "running" };
    let result: Awaited<ReturnType<AgentExecutor["execute"]>>;
    try {
      result = await this.executor.execute(
        { objective: prompt, constraints: [] },
        async (revisionPrompt, executionSignal) => {
          this.history = structuredClone(baseline);
          return this.generateDirect(revisionPrompt, executionSignal);
        },
        signal,
      );
    } catch (error) {
      this.history = baseline;
      this.lastReflection = { executionId: this.lastReflection.executionId, status: "failed" };
      throw error;
    }
    this.history = [...baseline, { role: "user", content: prompt }, { role: "assistant", content: result.output.text }];
    this.lastReflection = { executionId: result.executionId ?? this.lastReflection.executionId, status: "completed", qualityRisk: result.qualityRisk, finalReview: result.finalReview, rounds: result.rounds };
    return result.output;
  }

  private async generateDirect(prompt: string, signal?: AbortSignal) {
    const messages = await this.prepare(prompt);
    signal?.throwIfAborted();
    if (!this.stopGuard) {
      const result = await generateText({ model: this.model, system: this.system, messages: withCacheBreakpoint(messages, this.model), tools: this.tools, stopWhen: stepCountIs(this.maxSteps), ...(signal ? { abortSignal: signal } : {}) });
      signal?.throwIfAborted();
      this.history.push({ role: "assistant", content: result.text });
      this.onUsage?.(this.name, result.usage, usageModelIdentity(result.usage) ?? modelIdentity(this.model));
      return result;
    }
    return this.generateGuarded(messages, signal);
  }

  /** 停止守护循环：模型想停但本轮无新 checkpoint → 注入 reminder 重试，拦不住 maxBlocked 次放弃。 */
  private async generateGuarded(messages: ModelMessage[], signal?: AbortSignal) {
    const guard = this.stopGuard!;
    const working: ModelMessage[] = [...messages];
    for (let attempt = 1; ; attempt += 1) {
      signal?.throwIfAborted();
      this.guardedMarked = false;
      let blocked = false;
      const result = await generateText({
        model: this.model,
        system: this.system,
        messages: withCacheBreakpoint(working, this.model),
        tools: this.tools,
        stopWhen: stepCountIs(this.maxSteps),
        onStepFinish: async (step) => {
          if (step.finishReason === "stop" && !this.guardedMarked && (await guard.requireProgress?.() ?? true)) {
            blocked = true;
          }
        },
        ...(signal ? { abortSignal: signal } : {}),
      });
      signal?.throwIfAborted();
      if (blocked) {
        if (attempt >= this.maxBlocked) throw new StopBlockedError();
        const reminder = guard.reminder?.(attempt) ?? DEFAULT_REMINDER;
        working.push({ role: "user", content: `[进度守护] ${reminder}（第 ${attempt} 次提醒）` });
        continue;
      }
      this.history.push({ role: "assistant", content: result.text });
      this.onUsage?.(this.name, result.usage, usageModelIdentity(result.usage) ?? modelIdentity(this.model));
      return result;
    }
  }

  stream(prompt: string, signal?: AbortSignal) {
    if (this.executor) {
      const completed = this.generate(prompt, signal);
      const textStream = (async function* () {
        const result = await completed;
        yield result.text;
      })();
      return { textStream, completed };
    }
    const prepared = this.prepare(prompt);
    const resultPromise = prepared.then((messages) => { signal?.throwIfAborted(); return streamText({ model: this.model, system: this.system, messages: withCacheBreakpoint(messages, this.model), tools: this.tools, stopWhen: stepCountIs(this.maxSteps), ...(signal ? { abortSignal: signal } : {}) }); });
    const textStream = (async function* () {
      const result = await resultPromise;
      yield* result.textStream;
    })();
    const completed = resultPromise.then(async (result) => {
      const text = await result.text;
      this.history.push({ role: "assistant", content: text });
      const usage = await result.usage;
      this.onUsage?.(this.name, usage, usageModelIdentity(usage) ?? modelIdentity(this.model));
      return result;
    });
    return { textStream, completed };
  }

  private async prepare(prompt: string): Promise<ModelMessage[]> {
    this.history.push({ role: "user", content: prompt });
    this.history = await this.context.compress(this.history);
    return this.history;
  }
}

function modelIdentity(model: LanguageModelInstance): { provider: string; model: string } | undefined {
  return model.provider && model.modelId ? { provider: model.provider, model: model.modelId } : undefined;
}

/**
 * 提示词缓存策略（对应 docs/architecture.md §6.6 与长篇成本控制）：
 * 1. Anthropic 系：支持最多 4 个 cache_control 断点。我们在首条消息（静态前缀/System）
 *    和末尾 user 消息各落 1 个 `cache_control: { type: "ephemeral" }` 断点，
 *    实现“基础世界观/角色表跨会话复用 + 滚动上下文轮次递增缓存”。
 * 2. 浅拷贝不污染原始 history，保障会话与持久化纯净。
 */
export function withCacheBreakpoint(messages: readonly ModelMessage[], model: LanguageModelInstance): ModelMessage[] {
  if (model.provider !== "anthropic" || messages.length === 0) return messages as ModelMessage[];
  const result = [...messages];
  // 1. 首条消息静态断点（跨轮复用）
  const first = result[0];
  if (first && typeof first.content === "string") {
    result[0] = { ...first, providerOptions: { ...first.providerOptions, anthropic: { cacheControl: { type: "ephemeral" } } } };
  }
  // 2. 末条 user 消息滚动断点（本轮读上一轮写）
  const lastIndex = result.length - 1;
  if (lastIndex > 0) {
    const last = result[lastIndex];
    if (last && last.role === "user" && typeof last.content === "string") {
      result[lastIndex] = { ...last, providerOptions: { ...last.providerOptions, anthropic: { cacheControl: { type: "ephemeral" } } } };
    }
  }
  return result;
}

export function createAgent(options: AgentOptions): Agent {
  return new Agent(options);
}
