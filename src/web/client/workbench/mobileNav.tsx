export type WorkbenchPanel = "project" | "writing" | "status";

const panels: Array<{ id: WorkbenchPanel; label: string }> = [{ id: "project", label: "作品" }, { id: "writing", label: "创作" }, { id: "status", label: "状态" }];

export function MobileNav({ current, onChange }: { current: WorkbenchPanel; onChange(panel: WorkbenchPanel): void }) {
  return <nav className="mobile-workbench-nav" aria-label="创作台区域">
    {panels.map((panel) => <button key={panel.id} type="button" aria-current={current === panel.id ? "page" : undefined} onClick={() => onChange(panel.id)}>{panel.label}</button>)}
  </nav>;
}
