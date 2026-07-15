import { useCallback, useEffect, useRef, useState } from "react";
import { createApiClient, ApiError } from "./api/client.js";
import { SessionProvider, useSession } from "./auth/session.js";
import { LoginPage } from "./pages/login.js";
import { ProjectsPage, type Project } from "./pages/projects.js";

function Application() {
  const session = useSession();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const apiRef = useRef(createApiClient({ onUnauthorized: () => sessionRef.current.clear() }));

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

  async function logout() {
    try {
      await apiRef.current.request("/api/auth/logout", { method: "POST" });
    } finally {
      session.clear();
      setProjects([]);
      window.history.replaceState({}, "", "/login");
    }
  }

  if (loading && !session.authenticated) {
    return <main className="boot-state" aria-live="polite"><span className="loader" />正在打开书房</main>;
  }

  if (loadError && !session.authenticated) {
    return <main className="boot-state"><div className="message message-error" role="alert">{loadError}<button className="text-button" type="button" onClick={() => void loadProjects()}>重试</button></div></main>;
  }

  if (!session.authenticated) return <LoginPage api={apiRef.current} onAuthenticated={loadProjects} />;

  return <ProjectsPage api={apiRef.current} projects={projects} error={loadError} loading={loading} onProjectsChange={setProjects} onReload={loadProjects} onLogout={logout} />;
}

export function App() {
  return <SessionProvider><Application /></SessionProvider>;
}
