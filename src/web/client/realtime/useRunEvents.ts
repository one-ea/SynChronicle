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
}

const MAX_VISIBLE_EVENTS = 200;
export const initialRunViewState: RunViewState = { lastSequence: 0, stream: "", events: [] };

function objectPayload(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
}

export function reduceRunEvent(state: RunViewState, event: RunEventMessage): RunViewState {
  if (!Number.isSafeInteger(event.sequence) || event.sequence <= state.lastSequence) return state;
  const payload = objectPayload(event.payload);
  const delta = event.type === "stream" || event.type === "stream_delta" ? payload.delta : undefined;
  const reflection = event.type === "reflection" ? {
    round: typeof payload.round === "number" ? payload.round : undefined,
    maxRounds: typeof payload.maxRounds === "number" ? payload.maxRounds : undefined,
    score: typeof payload.score === "number" ? payload.score : undefined,
    passed: typeof payload.passed === "boolean" ? payload.passed : undefined,
  } : state.reflection;
  return {
    lastSequence: event.sequence,
    stream: typeof delta === "string" ? state.stream + delta : state.stream,
    events: [...state.events, event].slice(-MAX_VISIBLE_EVENTS),
    reflection,
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

    const connect = () => {
      if (stopped) return;
      setConnection(attempt === 0 ? "connecting" : "reconnecting");
      const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${scheme}//${window.location.host}/ws/runs/${encodeURIComponent(runId)}?after=${cursorRef.current}`);
      socket.addEventListener("open", () => { attempt = 0; setConnection("connected"); });
      socket.addEventListener("message", (message) => {
        try {
          const event = JSON.parse(String(message.data)) as RunEventMessage;
          dispatch(event);
        } catch {
          setConnection("error");
        }
      });
      socket.addEventListener("close", (event) => {
        if (stopped) return;
        attempt += 1;
        setConnection(event.code === 1013 ? "backpressure" : "reconnecting");
        timer = setTimeout(connect, Math.min(1000 * 2 ** (attempt - 1), 15_000));
      });
      socket.addEventListener("error", () => socket?.close());
    };
    connect();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      socket?.close();
    };
  }, [runId, subscribe]);

  return { state, connection };
}
