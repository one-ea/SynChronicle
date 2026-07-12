import { useEffect, useReducer, useState } from "react";
import { Box, Text } from "ink";
import type { RuntimeEvent } from "../domain/index.js";
import { Activity } from "./activity.js";
import { executeCommand, parseCommand } from "./commands.js";
import type { TuiHost } from "./events.js";
import { reduceTuiState } from "./events.js";
import { InterventionInput } from "./input.js";
import { ThreeColumnLayout } from "./layout.js";
import { Outline } from "./outline.js";
import { Sidebar } from "./sidebar.js";
import { theme } from "./theme.js";

export function Workbench({ host }: { host: TuiHost }) {
  const [state, dispatch] = useReducer(reduceTuiState, { snapshot: host.snapshot(), events: [], stream: "" }); const [busy, setBusy] = useState(false);
  useEffect(() => { let active = true; void (async () => { try { for await (const event of host.events()) if (active) dispatch({ type: "event", event }); } catch (error) { if (active) dispatch({ type: "error", error: message(error) }); } })(); void (async () => { try { for await (const delta of host.stream()) if (active) dispatch({ type: "stream", delta }); } catch (error) { if (active) dispatch({ type: "error", error: message(error) }); } })(); return () => { active = false; }; }, [host]);
  async function submit(value: string) { setBusy(true); try { const command = parseCommand(value); if (command) { const result = await executeCommand(host, command); dispatch({ type: "event", event: localEvent(result) }); } else { await host.continue(value); dispatch({ type: "event", event: localEvent(`用户干预: ${value}`) }); } dispatch({ type: "snapshot", snapshot: host.snapshot() }); } catch (error) { dispatch({ type: "error", error: message(error) }); } finally { setBusy(false); } }
  return <Box flexDirection="column"><Text bold color={theme.accent}>创作工作台 · {state.snapshot.provider}/{state.snapshot.model}</Text><ThreeColumnLayout sidebar={<Sidebar snapshot={state.snapshot} />} activity={<Activity events={state.events} stream={state.stream} error={state.error} />} outline={<Outline snapshot={state.snapshot} />} /><InterventionInput disabled={busy} onSubmit={(value) => void submit(value)} /></Box>;
}
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function localEvent(text: string): RuntimeEvent { return { type: "system", time: new Date().toISOString(), message: text }; }
