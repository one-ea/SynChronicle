import type { WorkbenchChapter } from "../pages/workbench.js";

interface ProjectNavProps {
  title: string;
  chapters: WorkbenchChapter[];
  selectedChapterId?: string;
  collapsed: boolean;
  presentation?: "desktop" | "embedded";
  onToggle(): void;
  onSelect(chapter: WorkbenchChapter): void;
}

export function ProjectNav({ title, chapters, selectedChapterId, collapsed, presentation = "desktop", onToggle, onSelect }: ProjectNavProps) {
  return <aside className="workbench-panel project-nav" aria-label="作品结构" data-collapsed={collapsed}>
    <header className="panel-heading">
      <div><p className="eyebrow">Manuscript</p><h2>{title}</h2></div>
      {presentation === "desktop" && <button className="panel-toggle" type="button" onClick={onToggle} aria-expanded={!collapsed} aria-label={collapsed ? "展开作品结构" : "折叠作品结构"}>{collapsed ? ">" : "<"}</button>}
    </header>
    {!collapsed && (chapters.length ? <ol className="chapter-list">
      {chapters.map((chapter) => <li key={chapter.id}>
        <button type="button" className={chapter.id === selectedChapterId ? "chapter-current" : ""} aria-current={chapter.id === selectedChapterId ? "page" : undefined} onClick={() => onSelect(chapter)} aria-label={`查看章节《${chapter.title}》`}>
          <span>{String(chapter.sequence).padStart(2, "0")}</span><strong>{chapter.title}</strong><small>{chapter.status === "draft" ? "草稿" : "规划"}</small>
        </button>
      </li>)}
    </ol> : <p className="panel-empty">作品还没有章节。</p>)}
  </aside>;
}
