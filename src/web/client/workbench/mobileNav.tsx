export type WorkbenchPanel = "project" | "writing" | "status";

const panels: Array<{ id: WorkbenchPanel; label: string; path: string }> = [
  { id: "project", label: "章节", path: "M4 5h16M4 12h16M4 19h10" },
  { id: "writing", label: "创作", path: "M4 20l4-1 11-11-3-3L5 16l-1 4Z" },
  { id: "status", label: "运行", path: "M4 12h4l2-6 4 12 2-6h4" },
];

export function MobileNav({ current, onChange }: { current: WorkbenchPanel; onChange(panel: WorkbenchPanel): void }) {
  return <nav className="mobile-workbench-nav" aria-label="创作台区域">
    {panels.map(({ id, label, path }) => <button key={id} type="button" aria-current={current === id ? "page" : undefined} onClick={() => onChange(id)}>
      <svg aria-hidden="true" viewBox="0 0 24 24"><path d={path} /></svg><span>{label}</span>
    </button>)}
  </nav>;
}
