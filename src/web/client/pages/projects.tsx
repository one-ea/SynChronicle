import { useEffect, useRef, useState, type ChangeEvent, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { ApiError, type ApiClient } from "../api/client.js";

export interface Project {
  id: string;
  userId: string;
  title: string;
  status: "active" | "archived";
  version: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

type DialogState = { kind: "create" } | { kind: "rename" | "archive"; project: Project } | null;

interface ProjectsPageProps {
  api: ApiClient;
  projects: Project[];
  error: string | null;
  logoutError: string | null;
  loading: boolean;
  onProjectsChange: Dispatch<SetStateAction<Project[]>>;
  onReload(): Promise<void>;
  onLogout(): Promise<void>;
}

function requestMessage(error: unknown, fallback: string): string {
  const requestId = error instanceof ApiError && error.requestId ? ` 请求 ID：${error.requestId}` : "";
  const kind = error && typeof error === "object" && "kind" in error ? error.kind : null;
  if (kind === "conflict") return `作品已在其他窗口更新，请刷新后重试。${requestId}`;
  if (kind === "forbidden") return `当前会话无权执行此操作。${requestId}`;
  return `${fallback}${requestId}`;
}

function PenIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Zm10-12 3 3" /></svg>;
}

function ArchiveIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16v13H4V7Zm-1-4h18v4H3V3Zm6 8h6" /></svg>;
}

export function ProjectsPage(props: ProjectsPageProps) {
  const [dialog, setDialog] = useState<DialogState>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [dialogPending, setDialogPending] = useState(false);
  const [importProgress, setImportProgress] = useState<number | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const mutationTokens = useRef(new Map<string, symbol>());

  useEffect(() => {
    if (!dialog) return;
    const element = dialogRef.current;
    const focusable = () => [...(element?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])") ?? [])];
    focusable()[0]?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDialog();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [dialog]);

  function openDialog(next: DialogState, trigger: HTMLButtonElement) {
    triggerRef.current = trigger;
    setMessage(null);
    setDialogPending(false);
    setDialog(next);
  }

  function closeDialog() {
    setDialog(null);
    queueMicrotask(() => triggerRef.current?.focus());
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = String(new FormData(event.currentTarget).get("title") ?? "").trim();
    if (!title) return;
    setDialogPending(true);
    try {
      const { project } = await props.api.request<{ project: Project }>("/api/projects/", { method: "POST", body: JSON.stringify({ title }) });
      props.onProjectsChange((current) => [project, ...current]);
      closeDialog();
    } catch (error) {
      setMessage(requestMessage(error, "作品创建失败。"));
    } finally {
      setDialogPending(false);
    }
  }

  async function rename(event: FormEvent<HTMLFormElement>, project: Project) {
    event.preventDefault();
    const title = String(new FormData(event.currentTarget).get("title") ?? "").trim();
    if (!title || title === project.title) return closeDialog();
    const token = Symbol(project.id);
    mutationTokens.current.set(project.id, token);
    props.onProjectsChange((current) => current.map((item) => item.id === project.id ? { ...item, title } : item));
    closeDialog();
    try {
      const result = await props.api.request<{ project: Project }>(`/api/projects/${project.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title, version: project.version }),
      });
      if (mutationTokens.current.get(project.id) === token) {
        props.onProjectsChange((current) => current.map((item) => item.id === project.id ? result.project : item));
      }
    } catch (error) {
      if (mutationTokens.current.get(project.id) === token) {
        props.onProjectsChange((current) => current.map((item) => item.id === project.id && item.title === title ? project : item));
        setMessage(requestMessage(error, "作品重命名失败。"));
      }
    } finally {
      if (mutationTokens.current.get(project.id) === token) mutationTokens.current.delete(project.id);
    }
  }

  async function archive(project: Project) {
    const token = Symbol(project.id);
    const originalIndex = props.projects.findIndex((item) => item.id === project.id);
    mutationTokens.current.set(project.id, token);
    props.onProjectsChange((current) => current.filter((item) => item.id !== project.id));
    closeDialog();
    try {
      await props.api.request(`/api/projects/${project.id}/archive`, {
        method: "POST",
        body: JSON.stringify({ version: project.version }),
      });
    } catch (error) {
      if (mutationTokens.current.get(project.id) === token) {
        props.onProjectsChange((current) => {
          if (current.some((item) => item.id === project.id)) return current;
          const restored = [...current];
          restored.splice(Math.min(Math.max(originalIndex, 0), restored.length), 0, project);
          return restored;
        });
        setMessage(requestMessage(error, "作品归档失败。"));
      }
    } finally {
      if (mutationTokens.current.get(project.id) === token) mutationTokens.current.delete(project.id);
    }
  }

  async function importArchive(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setMessage(null);
    setImportProgress(0);
    try {
      if (!props.api.importProject) throw new Error("Import unavailable");
      await props.api.importProject(file, setImportProgress);
      setMessage("导入完成，作品已加入书架。");
      await props.onReload();
    } catch (error) {
      setMessage(requestMessage(error, "作品导入失败，请检查归档格式。"));
    } finally {
      setImportProgress(null);
    }
  }

  async function exportArchive(project: Project) {
    setMessage(null);
    setExportingId(project.id);
    try {
      if (!props.api.exportProject) throw new Error("Export unavailable");
      await props.api.exportProject(project.id);
    }
    catch (error) { setMessage(requestMessage(error, "作品导出失败。")); }
    finally { setExportingId(null); }
  }

  return (
    <>
    <div className="app-shell" inert={dialog ? true : undefined} aria-hidden={dialog ? true : undefined}>
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <header className="site-header">
        <a className="wordmark" href="/projects" aria-label="SynChronicle 作品首页">SynChronicle</a>
        <nav aria-label="主导航">
          <a className="nav-current" href="/projects" aria-current="page">作品</a>
          <button className="text-button" type="button" onClick={() => void props.onLogout()}>退出登录</button>
        </nav>
      </header>
      <main className="projects-page" id="main-content">
        <header className="page-heading">
          <div>
            <p className="eyebrow">Library · 私人书架</p>
            <h1>你的作品</h1>
            <p>在这里整理每一条仍在生长的叙事线。</p>
          </div>
          <div className="page-actions">
            <label className="button button-secondary import-button" htmlFor="project-import">导入作品<input id="project-import" aria-label="导入作品归档" type="file" accept=".sync.zip,application/zip" onChange={(event) => void importArchive(event)} /></label>
            <button className="button button-primary" type="button" onClick={(event) => openDialog({ kind: "create" }, event.currentTarget)}>创建作品</button>
          </div>
        </header>

        {importProgress !== null && <div className="import-progress" role="status" aria-live="polite"><progress max="100" value={importProgress} />正在导入 {importProgress}%</div>}

        {(message || props.error || props.logoutError) && (
          <div className="message message-error error-row" role="alert">
            <span>{props.logoutError ?? message ?? props.error}</span>
            {props.error && <button className="text-button" type="button" onClick={() => void props.onReload()}>重试</button>}
            {props.logoutError && <button className="text-button" type="button" onClick={() => void props.onLogout()}>重试退出</button>}
          </div>
        )}

        {props.loading ? (
          <section className="loading-state" aria-live="polite" aria-busy="true"><span className="loader" />正在整理书架</section>
        ) : props.projects.length === 0 ? (
          <section className="empty-state">
            <p className="section-number">空白页</p>
            <h2>这里还没有作品</h2>
            <p>从一个标题开始，给下一部故事留出位置。</p>
          </section>
        ) : (
          <section className="project-list" aria-label="活动作品">
            {props.projects.map((project, index) => (
              <article className="project-row" key={project.id}>
                <span className="project-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                <div className="project-copy">
                  <h2><a href={`/projects/${project.id}`}>{project.title}</a></h2>
                  <p>最后整理于 {new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" }).format(new Date(project.updatedAt))}</p>
                </div>
                <div className="project-actions">
                  <button className="icon-button export-button" type="button" disabled={exportingId === project.id} aria-label={`导出《${project.title}》`} onClick={() => void exportArchive(project)}>导出</button>
                  <button className="icon-button" type="button" aria-label={`重命名《${project.title}》`} onClick={(event) => openDialog({ kind: "rename", project }, event.currentTarget)}><PenIcon /></button>
                  <button className="icon-button" type="button" aria-label={`归档《${project.title}》`} onClick={(event) => openDialog({ kind: "archive", project }, event.currentTarget)}><ArchiveIcon /></button>
                </div>
              </article>
            ))}
          </section>
        )}
      </main>

    </div>
      {dialog && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDialog(); }}>
          <section ref={dialogRef} className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
            {dialog.kind === "create" && <form onSubmit={create}>
              <p className="section-number">新手稿</p><h2 id="dialog-title">创建作品</h2>
              <label htmlFor="project-title">作品名称</label>
              <input id="project-title" name="title" autoFocus maxLength={256} required />
              {message && <p className="message message-error" role="alert">{message}</p>}
              <div className="dialog-actions"><button className="text-button" type="button" onClick={closeDialog}>取消</button><button className="button button-primary" type="submit" disabled={dialogPending}>确认创建</button></div>
            </form>}
            {dialog.kind === "rename" && <form onSubmit={(event) => void rename(event, dialog.project)}>
              <p className="section-number">编辑书名</p><h2 id="dialog-title">重命名作品</h2>
              <label htmlFor="rename-title">新的作品名称</label>
              <input id="rename-title" name="title" autoFocus defaultValue={dialog.project.title} maxLength={256} required />
              <div className="dialog-actions"><button className="text-button" type="button" onClick={closeDialog}>取消</button><button className="button button-primary" type="submit">保存名称</button></div>
            </form>}
            {dialog.kind === "archive" && <div>
              <p className="section-number">移出书架</p><h2 id="dialog-title">归档《{dialog.project.title}》</h2>
              <p>作品内容会完整保留，活动书架将不再显示它。</p>
              <div className="dialog-actions"><button className="text-button" type="button" onClick={closeDialog}>取消</button><button className="button button-danger" type="button" onClick={() => void archive(dialog.project)}>确认归档</button></div>
            </div>}
          </section>
        </div>
      )}
    </>
  );
}
