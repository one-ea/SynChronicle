import { useEffect, useReducer, useRef, useState } from "react";

export type ConnectionState = "idle" | "connecting" | "connected" | "reconnecting" | "backpressure" | "error";

export interface RunEventMessage {
  sequence: number;
  type: string;
  agent?: string;
  message?: string;
  createdAt?: string;
  payload?: unknown;
}

export interface RunViewState {
  lastSequence: number;
  stream: string;
  events: RunEventMessage[];
  reflection?: { round?: number; maxRounds?: number; score?: number; passed?: boolean };
  agents: Array<{ name: string; state: string; summary?: string; sequence: number }>;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number; cost: string; byAgent: Array<{ agent: string; inputTokens: number; outputTokens: number; totalTokens: number; cost: string }> };
  commands: Record<string, { status: "applied" | "failed"; retryable?: boolean; category?: string; message?: string }>;
}

const MAX_VISIBLE_EVENTS = 200;
export const initialRunViewState: RunViewState = { lastSequence: 0, stream: "", events: [], agents: [], commands: {} };

export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(800 * 2 ** Math.max(0, attempt - 1), 15_000);
  return Math.min(15_000, Math.round(base * (1 + random() * 0.5)));
}

function objectPayload(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
}

export function reduceRunEvent(state: RunViewState, event: RunEventMessage): RunViewState {
  if (!Number.isSafeInteger(event.sequence) || event.sequence <= state.lastSequence) return state;
  const payload = objectPayload(event.payload);
  const runtimePayload = objectPayload(payload.payload);
  const delta = event.type === "stream.delta"
    ? payload.text
    : event.type === "stream" || event.type === "stream_delta"
      ? payload.delta
      : undefined;
  const reflectionPayload = event.type === "reflection" && Object.keys(runtimePayload).length ? runtimePayload : payload;
  const reflection = event.type === "reflection" ? {
    round: typeof reflectionPayload.round === "number" ? reflectionPayload.round : undefined,
    maxRounds: typeof reflectionPayload.maxRounds === "number" ? reflectionPayload.maxRounds : undefined,
    score: typeof reflectionPayload.score === "number" ? reflectionPayload.score : undefined,
    passed: typeof reflectionPayload.passed === "boolean" ? reflectionPayload.passed : undefined,
  } : state.reflection;
  const nested = objectPayload(payload.payload);
  const agentName = typeof event.agent === "string" ? event.agent : typeof payload.agent === "string" ? payload.agent : typeof nested.agent === "string" ? nested.agent : undefined;
  const agents = agentName ? [{ name: agentName, state: event.type, summary: typeof payload.message === "string" ? payload.message : typeof nested.message === "string" ? nested.message : undefined, sequence: event.sequence }, ...state.agents.filter(({ name }) => name !== agentName)] : state.agents;
  const usagePayload = event.type === "usage.snapshot" && typeof payload.totalTokens !== "number" ? nested : payload;
  const usage = event.type === "usage.snapshot" && typeof usagePayload.totalTokens === "number" ? usagePayload as unknown as RunViewState["usage"] : state.usage;
  const commandId = typeof payload.commandId === "string" ? payload.commandId : undefined;
  const commands = commandId && (event.type === "command.applied" || event.type === "command.error") ? { ...state.commands, [commandId]: event.type === "command.applied" ? { status: "applied" as const } : { status: "failed" as const, retryable: payload.retryable === true, category: typeof payload.category === "string" ? payload.category : undefined, message: typeof payload.message === "string" ? payload.message : undefined } } : state.commands;
  return {
    lastSequence: event.sequence,
    stream: typeof delta === "string" ? state.stream + delta : state.stream,
    events: [...state.events, event].slice(-MAX_VISIBLE_EVENTS),
    reflection,
    agents,
    usage,
    commands,
  };
}

interface UseRunEventsOptions {
  runId?: string;
  initialEvents?: RunEventMessage[];
  subscribe?: (listener: (event: RunEventMessage) => void) => () => void;
}

export function useRunEvents({ runId, initialEvents = [], subscribe }: UseRunEventsOptions) {
  const [state, dispatch] = useReducer(reduceRunEvent, initialEvents, (events) => events.reduce(reduceRunEvent, initialRunViewState));
  const [connection, setConnection] = useState<ConnectionState>(runId ? "connecting" : "idle");
  const cursorRef = useRef(state.lastSequence);
  cursorRef.current = state.lastSequence;

  useEffect(() => {
    if (subscribe) {
      setConnection("connected");
      return subscribe(dispatch);
    }
    if (!runId || typeof WebSocket === "undefined") {
      setConnection("idle");
      return;
    }
    let socket: WebSocket | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let attempt = 0;
    let stableTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (stopped) return;
      setConnection(attempt === 0 ? "connecting" : "reconnecting");
      const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${scheme}//${window.location.host}/ws/runs/${encodeURIComponent(runId)}?after=${cursorRef.current}`);
      socket.addEventListener("open", () => {
        setConnection("connected");
        stableTimer = setTimeout(() => { attempt = 0; }, 5000);
      });
      socket.addEventListener("message", (message) => {
        try {
          const event = JSON.parse(String(message.data)) as RunEventMessage;
          attempt = 0;
          dispatch(event);
        } catch {
          setConnection("error");
        }
      });
      socket.addEventListener("close", (event) => {
        if (stopped) return;
        if (stableTimer) clearTimeout(stableTimer);
        attempt += 1;
        setConnection(event.code === 1013 ? "backpressure" : "reconnecting");
        timer = setTimeout(connect, reconnectDelay(attempt));
      });
      socket.addEventListener("error", () => socket?.close());
    };
    connect();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (stableTimer) clearTimeout(stableTimer);
      socket?.close();
    };
  }, [runId, subscribe]);

  return { state, connection };
}
