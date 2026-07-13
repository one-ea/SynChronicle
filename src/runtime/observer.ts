import type { RuntimeEvent } from "../domain/index.js";
import type { ReflectionEvent } from "../agents/reflection/index.js";
let eventSequence = 0;
export function systemEvent(message: string, level = "info"): RuntimeEvent & { id: string; level: string } { return { id: `e${++eventSequence}`, type: "system", time: new Date().toISOString(), message, payload: { level }, level }; }
export function errorEvent(error: unknown): RuntimeEvent { const message = error instanceof Error ? error.message : String(error); return { type: "error", time: new Date().toISOString(), message }; }
export function reflectionEvent(event: ReflectionEvent & { agent: string }): RuntimeEvent {
  const { type: message, agent, ...details } = event;
  const phase = message === "reflection.started" ? "started"
    : message === "review.completed" ? "review_completed"
      : message === "revision.started" ? "revision_started"
        : "completed";
  return { type: "reflection", time: new Date().toISOString(), agent, message, payload: { phase, ...details } };
}
