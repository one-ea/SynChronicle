import { createContext, useContext, useState } from "react";
import { Startup } from "./startup.js";
import type { TuiHost } from "./events.js";
import { Workbench } from "./workbench.js";

const HostContext = createContext<TuiHost | null>(null);
export function useHost(): TuiHost { const host = useContext(HostContext); if (!host) throw new Error("TUI HostContext is missing"); return host; }

export function App({ host, version, initialPage = "startup" }: { host: TuiHost; version?: string; initialPage?: "startup" | "workbench" }) {
  const [page, setPage] = useState(initialPage);
  function start(prompt: string) { setPage("workbench"); void host.startPrepared(prompt).catch(() => undefined); }
  return <HostContext.Provider value={host}>{page === "startup" ? <Startup version={version} onStart={start} onCoCreate={start} /> : <Workbench host={host} />}</HostContext.Provider>;
}
