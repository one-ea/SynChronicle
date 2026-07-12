import type { RuntimeEvent } from "../domain/index.js";
import type { Notifier } from "../notify/index.js";
export function notifyRuntimeEvent(notifier: Notifier | undefined, event: RuntimeEvent): void { if (!notifier || !["system", "error"].includes(event.type)) return; notifier.send({ kind: event.type === "error" ? "error" : "run", level: event.type === "error" ? "error" : "info", title: "SynChronicle", body: event.message ?? event.type }); }
