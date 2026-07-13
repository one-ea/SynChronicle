import { generateText, stepCountIs, streamText, tool, type LanguageModel, type ModelMessage, type ToolSet } from "ai";
import type { RegisteredTool } from "../tools/registry.js";
import { ContextManager } from "./context.js";

type LanguageModelInstance = Exclude<LanguageModel, string>;
type GenerateResult = Awaited<ReturnType<typeof generateText>>;

export interface AgentExecutor {
  execute(
    task: { objective: string; constraints: string[] },
    generate: (prompt: string) => Promise<GenerateResult>,
  ): Promise<{ output: GenerateResult }>;
}

export interface AgentOptions {
  name: string;
  model: LanguageModelInstance;
  system: string;
  tools?: Record<string, RegisteredTool<any>>;
  context?: ContextManager;
  maxSteps?: number;
  onUsage?: (name: string, usage: unknown) => void;
  executor?: AgentExecutor;
}

export class Agent {
  readonly name: string;
  readonly context: ContextManager;
  private readonly model: LanguageModelInstance;
  private readonly system: string;
  private readonly tools: ToolSet;
  private readonly maxSteps: number;
  private readonly onUsage?: AgentOptions["onUsage"];
  private readonly executor?: AgentExecutor;
  private history: ModelMessage[] = [];

  constructor({ name, model, system, tools = {}, context = new ContextManager({ window: 200000 }), maxSteps = 20, onUsage, executor }: AgentOptions) {
    this.name = name;
    this.model = model;
    this.system = system;
    this.context = context;
    this.maxSteps = maxSteps;
    this.onUsage = onUsage;
    this.executor = executor;
    this.tools = Object.fromEntries(Object.entries(tools).map(([toolName, definition]) => [toolName, tool({
      description: definition.description,
      inputSchema: definition.inputSchema,
      execute: async (input) => definition.execute(input),
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

  async generate(prompt: string) {
    if (!this.executor) return this.generateDirect(prompt);
    const result = await this.executor.execute(
      { objective: prompt, constraints: [] },
      (revisionPrompt) => this.generateDirect(revisionPrompt),
    );
    return result.output;
  }

  private async generateDirect(prompt: string) {
    const messages = await this.prepare(prompt);
    const result = await generateText({ model: this.model, system: this.system, messages, tools: this.tools, stopWhen: stepCountIs(this.maxSteps) });
    this.history.push({ role: "assistant", content: result.text });
    this.onUsage?.(this.name, result.usage);
    return result;
  }

  stream(prompt: string) {
    if (this.executor) {
      const completed = this.generate(prompt);
      const textStream = (async function* () {
        const result = await completed;
        yield result.text;
      })();
      return { textStream, completed };
    }
    const prepared = this.prepare(prompt);
    const resultPromise = prepared.then((messages) => streamText({ model: this.model, system: this.system, messages, tools: this.tools, stopWhen: stepCountIs(this.maxSteps) }));
    const textStream = (async function* () {
      const result = await resultPromise;
      yield* result.textStream;
    })();
    const completed = resultPromise.then(async (result) => {
      const text = await result.text;
      this.history.push({ role: "assistant", content: text });
      this.onUsage?.(this.name, await result.usage);
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

export function createAgent(options: AgentOptions): Agent {
  return new Agent(options);
}
