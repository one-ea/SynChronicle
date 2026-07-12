import type { RuntimeEvent } from "../domain/index.js";
let eventSequence = 0;
export function systemEvent(message: string, level = "info"): RuntimeEvent & { id: string; level: string } { return { id: `e${++eventSequence}`, type: "system", time: new Date().toISOString(), message, payload: { level }, level }; }
export function errorEvent(error: unknown): RuntimeEvent { const message = error instanceof Error ? error.message : String(error); return { type: "error", time: new Date().toISOString(), message }; }
