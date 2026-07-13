import type { Config } from "../config/index.js";
import { ConfigSchema } from "../config/index.js";
import type { Bundle, ReflectionRuntimePayload, RuntimeEvent, RuntimeQueueItem } from "../domain/index.js";
import { createModelSet } from "../providers/index.js";
import { Store } from "../store/index.js";
import { buildCoordinator } from "../agents/build.js";
import { AsyncQueue } from "./asyncQueue.js";
import { RuntimeStream } from "./stream.js";
import { buildResumePrompt } from "./resume.js";
import { errorEvent, reflectionEvent, systemEvent } from "./observer.js";
import { importTextFile } from "./imp/index.js";
import { exportNovel, type ExportOptions } from "./exp/index.js";
import { simulateSources } from "./sim/index.js";
import { normalizeUsage, UsageTracker, type ModelUsage } from "./usage.js";
import type { AskUserHandler } from "../tools/registry.js";
import type { ReflectionEvent } from "../agents/reflection/index.js";

export interface RuntimeObserver { reflection(event: ReflectionEvent & { agent: string }): void; usage(agent: string, usage: ModelUsage | undefined): void; }
export interface RuntimeAgent { run(prompt: string): AsyncIterable<string>; setObserver?(observer: RuntimeObserver): void; abort(reason: string): void; close(): void | Promise<void>; }
export interface HostDependencies { agent?: RuntimeAgent; store?: Store; askUser?: AskUserHandler }
type RuntimeState = "idle" | "running" | "paused" | "completed" | "closed";

export class Host {
  readonly store: Store;
  readonly usage: UsageTracker;
  private state: RuntimeState = "idle";
  private recoveryLabel: string | null = null;
  private reflection: { round?: number; maxRounds?: number; score?: number; passed?: boolean } | undefined;
  private eventQueue = new AsyncQueue<RuntimeEvent>();
  private output = new RuntimeStream();
  private queueWrites = new Set<Promise<void>>();
  private queueError: Error | null = null;
  private constructor(private readonly config: Config, private readonly agent: RuntimeAgent, store: Store) { this.store = store; this.usage = new UsageTracker((state) => this.store.usage.save(state)); this.agent.setObserver?.({ reflection: (event) => this.observeReflection(event), usage: (agent, usage) => this.usage.record(agent, usage) }); }

  static async new(config: Config, bundle: Bundle, dependencies: HostDependencies = {}): Promise<Host> { const cfg = ConfigSchema.parse(config); const store = dependencies.store ?? new Store(cfg.output_dir ?? "output/novel"); await store.init(); let runtimeAgent = dependencies.agent; let host: Host | undefined; if (!runtimeAgent) { const built = buildCoordinator(cfg, store, createModelSet(cfg), bundle, (agent, usage) => host?.usage.record(agent, normalizeUsage(usage)), undefined, undefined, dependencies.askUser, (event) => host?.observeReflection(event)); runtimeAgent = { run(prompt) { const stream = built.coordinator.stream(prompt); return stream.textStream; }, abort() { built.coordinator.clear(); }, close() { built.coordinator.clear(); } }; } host = new Host(cfg, runtimeAgent, store); host.usage.load(await store.usage.load()); return host; }

  async startPrepared(prompt: string): Promise<void> { if (!prompt.trim()) throw new Error("prompt is empty"); await this.run(prompt, "启动创作"); }
  async resume(): Promise<{ label: string | null; error?: Error }> { const data = buildResumePrompt(await this.store.progress.load(), await this.store.runMeta.load()); this.recoveryLabel = data.label; if (!data.label) return { label: null }; try { await this.run(data.prompt, data.label); return { label: data.label }; } catch (error) { return { label: data.label, error: error instanceof Error ? error : new Error(String(error)) }; } }
  async continue(prompt: string): Promise<void> { if (!prompt.trim()) throw new Error("continue prompt is empty"); await this.run(prompt, "继续创作"); }
  abort(reason: string, level = "info"): void { if (this.state === "closed") return; this.agent.abort(reason); this.state = "paused"; this.emit({ ...systemEvent(reason, level), payload: { level } }); }
  async close(): Promise<void> { if (this.state === "closed") return; let failure: Error | null = null; try { await this.agent.close(); } catch (error) { failure = toError(error); } try { await this.usage.flush(); } catch (error) { failure ??= toError(error); } await Promise.all([...this.queueWrites]); failure ??= this.queueError; this.state = "closed"; this.eventQueue.close(); this.output.end(); if (failure) throw failure; }
  events(): AsyncIterable<RuntimeEvent> { return this.eventQueue; }
  stream(): AsyncIterable<string> { return this.output.iterable(); }
  snapshot() { const progress = { runtimeState: this.state, recoveryLabel: this.recoveryLabel, usage: this.usage.snapshot(), provider: this.config.provider, model: this.config.model, reflection: this.reflection }; return structuredClone(progress); }
  async replayQueue(maxItems = 100): Promise<RuntimeQueueItem[]> { const items = await this.store.runtime.loadQueue(); return items.slice(-Math.max(0, maxItems)); }
  async importText(path: string): Promise<{ chapters: number }> { const chapters = await importTextFile(path); if (!chapters.length) throw new Error("文本中没有可导入的章节"); for (const chapter of chapters) await this.store.drafts.saveFinalChapter(chapter.chapter, `# ${chapter.title}\n\n${chapter.content}`); const words = chapters.reduce((sum, chapter) => sum + [...chapter.content.replace(/\s/g, "")].length, 0); await this.store.progress.save({ novel_name: "", phase: "writing", current_chapter: chapters.length + 1, total_chapters: chapters.length, completed_chapters: chapters.map((chapter) => chapter.chapter), total_word_count: words, flow: "writing", in_progress_chapter: 0, pending_rewrites: [] }); return { chapters: chapters.length }; }
  export(options: ExportOptions) { return exportNovel(this.store, options); }
  simulate(options: { sources: string[] }) { return simulateSources(options.sources); }

  private async run(prompt: string, label: string): Promise<void> { if (this.state === "running" || this.state === "closed") throw new Error(`host is ${this.state}`); this.state = "running"; this.emit(systemEvent(label)); try { for await (const delta of this.agent.run(prompt)) { this.output.write(delta); await this.store.runtime.appendQueue({ seq: 0, time: new Date().toISOString(), kind: "stream_delta", priority: "background", payload: { delta } }); } this.state = "completed"; this.emit(systemEvent("运行完成", "success")); } catch (error) { this.state = "paused"; this.emit(errorEvent(error)); throw error; } finally { this.output.end(); } }
  private observeReflection(event: ReflectionEvent & { agent: string }): void { const projected = reflectionEvent(event); this.updateReflection(projected.payload); this.emit(projected); }
  private updateReflection(payload: ReflectionRuntimePayload): void { if (payload.phase === "started") this.reflection = { round: 1, maxRounds: payload.maxRounds }; else if (payload.phase === "revision_started") this.reflection = { ...this.reflection, round: payload.round }; else if (payload.phase === "review_completed") this.reflection = { ...this.reflection, round: payload.round, score: payload.score, passed: payload.passed }; else this.reflection = { ...this.reflection, round: payload.rounds, score: payload.score, passed: payload.passed }; }
  private emit(event: RuntimeEvent): void { this.eventQueue.push(event); this.trackQueueWrite(this.store.runtime.appendQueue({ seq: 0, time: event.time ?? new Date().toISOString(), kind: "ui_event", priority: event.type === "error" ? "control" : "background", category: event.type.toUpperCase(), summary: event.message, payload: event })); }
  private trackQueueWrite(operation: Promise<unknown>): void { let tracked: Promise<void>; tracked = operation.then(() => undefined, (error) => { this.queueError ??= toError(error); }).finally(() => this.queueWrites.delete(tracked)); this.queueWrites.add(tracked); }
}

function toError(error: unknown): Error { return error instanceof Error ? error : new Error(String(error)); }
