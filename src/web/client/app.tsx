import { useCallback, useEffect, useRef, useState } from "react";
import { createApiClient, ApiError } from "./api/client.js";
import { SessionProvider, useSession } from "./auth/session.js";
import { LoginPage } from "./pages/login.js";
import { ProjectsPage, type Project } from "./pages/projects.js";
import { WorkbenchPage, type WorkbenchProject } from "./pages/workbench.js";
import { SettingsPage } from "./pages/settings.js";
import { AdminPage } from "./pages/admin.js";

function Application() {
  const session = useSession();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [workbenchProject, setWorkbenchProject] = useState<WorkbenchProject | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const apiRef = useRef(createApiClient({
    onUnauthorized: (path) => {
      if (path !== "/api/auth/logout") sessionRef.current.clear();
    },
  }));

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await apiRef.current.request<{ projects: Project[] }>("/api/projects/");
      setProjects(result.projects);
      sessionRef.current.restore();
      if (window.location.pathname === "/" || window.location.pathname === "/login") {
        window.history.replaceState({}, "", "/projects");
      }
    } catch (error) {
      if (!(error instanceof ApiError && error.kind === "unauthorized")) {
        const requestId = error instanceof ApiError && error.requestId ? ` 请求 ID：${error.requestId}` : "";
        setLoadError(`作品加载失败。${requestId}`);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadProjects(); }, [loadProjects]);

  const workbenchMatch = window.location.pathname.match(/^\/projects\/([^/]+)$/);
  useEffect(() => {
    if (!session.authenticated || !workbenchMatch) return;
    let active = true;
    apiRef.current.request<{ workbench: WorkbenchProject }>(`/api/projects/${encodeURIComponent(workbenchMatch[1]!)}/workbench`).then(({ workbench }) => {
      if (active) setWorkbenchProject(workbench);
    }).catch((error) => {
      if (active && !(error instanceof ApiError && error.kind === "unauthorized")) setLoadError("创作台加载失败，请返回作品页重试。");
    });
    return () => { active = false; };
  }, [session.authenticated, workbenchMatch?.[1]]);

  async function logout() {
    try {
      await apiRef.current.request("/api/auth/logout", { method: "POST" });
      setLogoutError(null);
      session.clear();
      setProjects([]);
      window.history.replaceState({}, "", "/login");
    } catch (error) {
      const requestId = error instanceof ApiError && error.requestId ? ` 请求 ID：${error.requestId}` : "";
      setLogoutError(`退出失败，请重试。${requestId}`);
    }
  }

  if (loading && !session.authenticated) {
    return <main className="boot-state" aria-live="polite"><span className="loader" />正在打开书房</main>;
  }

  if (loadError && !session.authenticated) {
    return <main className="boot-state"><div className="message message-error" role="alert">{loadError}<button className="text-button" type="button" onClick={() => void loadProjects()}>重试</button></div></main>;
  }

  if (!session.authenticated) return <LoginPage api={apiRef.current} onAuthenticated={loadProjects} />;

  if (window.location.pathname === "/settings") return <SettingsPage api={apiRef.current} />;
  if (window.location.pathname === "/admin") return session.user?.role === "admin" ? <AdminPage api={apiRef.current} /> : <main className="boot-state">无权访问管理页面</main>;

  if (workbenchMatch) {
    if (loadError) return <main className="boot-state"><div className="message message-error" role="alert">{loadError}<a className="text-button" href="/projects">返回作品页</a></div></main>;
    if (!workbenchProject) return <main className="boot-state" aria-live="polite"><span className="loader" />正在展开手稿</main>;
    return <WorkbenchPage api={apiRef.current} project={workbenchProject} />;
  }

  return <ProjectsPage api={apiRef.current} projects={projects} error={loadError} logoutError={logoutError} loading={loading} onProjectsChange={setProjects} onReload={loadProjects} onLogout={logout} />;
}

export function App() {
  return <SessionProvider><Application /></SessionProvider>;
}
