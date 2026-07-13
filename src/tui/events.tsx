import type { RuntimeEvent } from "../domain/index.js";
import type { ExportOptions } from "../runtime/exp/index.js";

export interface TuiSnapshot {
  runtimeState: string;
  recoveryLabel: string | null;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number; costUSD: number };
  provider?: string;
  model?: string;
  phase?: string;
  completedCount?: number;
  totalChapters?: number;
  outline?: Array<{ chapter: number; title: string }>;
  agents?: Array<{ name: string; state: string; summary?: string }>;
  pendingSteer?: string;
  reflection?: { round?: number; maxRounds?: number; score?: number; passed?: boolean };
}

export interface TuiHost {
  events(): AsyncIterable<RuntimeEvent>;
  stream(): AsyncIterable<string>;
  snapshot(): TuiSnapshot;
  startPrepared(prompt: string): Promise<void>;
  continue(prompt: string): Promise<void>;
  abort(reason: string, level?: string): void;
  export(options: ExportOptions): Promise<{ path: string; chapters: number }>;
  importText(path: string): Promise<{ chapters: number }>;
  switchModel?(role: string, provider: string, model: string): Promise<void> | void;
  diagnose?(): Promise<{ path?: string; summary: string }>;
}

export interface TuiState {
  snapshot: TuiSnapshot;
  events: RuntimeEvent[];
  stream: string;
  error?: string;
}

export type TuiAction =
  | { type: "event"; event: RuntimeEvent }
  | { type: "stream"; delta: string }
  | { type: "snapshot"; snapshot: TuiSnapshot }
  | { type: "error"; error: string };

export function reduceTuiState(state: TuiState, action: TuiAction): TuiState {
  switch (action.type) {
    case "event": return { ...state, snapshot: withReflection(state.snapshot, action.event), events: [...state.events.slice(-499), action.event], error: action.event.type === "error" ? action.event.message : state.error };
    case "stream": return { ...state, stream: (state.stream + action.delta).slice(-64_000) };
    case "snapshot": return { ...state, snapshot: { ...action.snapshot, reflection: action.snapshot.reflection ?? state.snapshot.reflection } };
    case "error": return { ...state, error: action.error };
  }
}

function withReflection(snapshot: TuiSnapshot, event: RuntimeEvent): TuiSnapshot {
  if (event.type !== "reflection" || !event.payload || typeof event.payload !== "object") return snapshot;
  const payload = event.payload as { phase?: string; round?: number; rounds?: number; maxRounds?: number; score?: number; passed?: boolean };
  if (payload.phase === "started") return { ...snapshot, reflection: { maxRounds: payload.maxRounds } };
  if (payload.phase === "revision_started") return { ...snapshot, reflection: { ...snapshot.reflection, round: payload.round } };
  if (payload.phase === "review_completed") return { ...snapshot, reflection: { ...snapshot.reflection, round: payload.round, score: payload.score, passed: payload.passed } };
  if (payload.phase === "completed") return { ...snapshot, reflection: { ...snapshot.reflection, round: payload.rounds, score: payload.score, passed: payload.passed } };
  return snapshot;
}
