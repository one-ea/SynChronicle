import { ReflectionRuntimeEventSchema, type ErrorEvent, type ReflectionRuntimeEvent, type SystemEvent } from "../domain/index.js";
import type { ReflectionEvent } from "../agents/reflection/index.js";
let eventSequence = 0;
export function systemEvent(message: string, level = "info"): SystemEvent & { id: string; level: string } { return { id: `e${++eventSequence}`, type: "system", time: new Date().toISOString(), message, payload: { level }, level }; }
export function errorEvent(error: unknown): ErrorEvent { const message = error instanceof Error ? error.message : String(error); return { type: "error", time: new Date().toISOString(), message }; }
export function reflectionEvent(event: ReflectionEvent & { agent: string }): ReflectionRuntimeEvent {
  const { type: message, agent, id, sequence, ...details } = event;
  const phase = message === "reflection.started" ? "started"
    : message === "review.completed" ? "review_completed"
      : message === "revision.started" ? "revision_started"
        : "completed";
  return ReflectionRuntimeEventSchema.parse({ type: "reflection", id, sequence, time: new Date().toISOString(), agent, message, payload: { phase, ...details } });
}
