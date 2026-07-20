import { useEffect, useState } from "react";

export type WorkbenchLayoutMode = "mobile" | "tablet" | "desktop";

export function resolveWorkbenchLayout(width: number): WorkbenchLayoutMode {
  if (width < 768) return "mobile";
  if (width < 1200) return "tablet";
  return "desktop";
}

export function useWorkbenchLayout(): WorkbenchLayoutMode {
  const [mode, setMode] = useState(() => resolveWorkbenchLayout(window.innerWidth));

  useEffect(() => {
    function update() {
      setMode(resolveWorkbenchLayout(window.innerWidth));
    }
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return mode;
}
