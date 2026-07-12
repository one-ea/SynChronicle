import { FileIO } from "./io.js";
export class SessionStore {
  private seq = new Map<string, number>();
  private tasks = new Map<string, string>();
  constructor(private readonly io: FileIO) {}
  logCocreate(entry: unknown) { return this.io.appendJSONLine("meta/sessions/cocreate.jsonl", entry); }
  log(path: string, message: unknown) { return this.io.appendJSONLine(path, message); }
  coordinatorLogger(lookup?: (agent: string) => { provider?: string; model?: string }) { return (message: Record<string, unknown>) => this.logMessage("meta/sessions/coordinator.jsonl", message, lookup?.("coordinator")); }
  subAgentLogger(lookup?: (agent: string) => { provider?: string; model?: string }) { return (agent: string, task: string, message: Record<string, unknown>) => this.logMessage(this.subAgentPath(agent, task), message, lookup?.(agent)); }
  private logMessage(path: string, message: Record<string, unknown>, meta?: object) { const usage = message.usage; const value = message.role === "assistant" && usage ? { ...message, ...(meta && { _meta: meta }) } : message; return this.io.appendJSONLine(path, value); }
  private subAgentPath(agent: string, task: string) { const chapter = task.match(/第\s*(\d+)\s*章/)?.[1]; if (chapter && Number(chapter) > 0) return `meta/sessions/agents/${agent}-ch${String(Number(chapter)).padStart(2, "0")}.jsonl`; const key = `${agent}|${task}`; let suffix = this.tasks.get(key); if (!suffix) { suffix = String((this.seq.get(agent) ?? 0) + 1).padStart(3, "0"); this.seq.set(agent, Number(suffix)); this.tasks.set(key, suffix); } return `meta/sessions/agents/${agent}-${suffix}.jsonl`; }
}
export const CompactTag = "[session_compact:";
export const isCompacted = (text: string) => text.startsWith(CompactTag);
