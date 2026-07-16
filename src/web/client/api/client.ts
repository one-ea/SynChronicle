export type ApiErrorKind = "unauthorized" | "forbidden" | "conflict" | "request";

export class ApiError extends Error {
  constructor(
    public readonly kind: ApiErrorKind,
    message: string,
    public readonly status: number,
    public readonly requestId: string | null,
  ) {
    super(message);
  }
}

interface ApiClientOptions {
  onUnauthorized?: (path: string) => void;
}

function createRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `web-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createApiClient(options: ApiClientOptions = {}) {
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    headers.set("x-request-id", createRequestId());
    if (init.body !== undefined) headers.set("content-type", "application/json");

    let response: Response;
    try {
      response = await fetch(path, { ...init, credentials: "same-origin", headers });
    } catch {
      throw new ApiError("request", "网络连接失败", 0, null);
    }

    const requestId = response.headers.get("x-request-id");
    if (!response.ok) {
      const kind: ApiErrorKind = response.status === 401
        ? "unauthorized"
        : response.status === 403
          ? "forbidden"
          : response.status === 409
            ? "conflict"
            : "request";
      if (kind === "unauthorized") options.onUnauthorized?.(path);
      throw new ApiError(kind, `请求失败 (${response.status})`, response.status, requestId);
    }
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  }

  function importProject<T>(file: File, onProgress: (percent: number) => void): Promise<T> {
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open("POST", `/api/projects/import?filename=${encodeURIComponent(file.name)}`);
      request.responseType = "json";
      request.setRequestHeader("content-type", file.type || "application/zip");
      request.setRequestHeader("x-request-id", createRequestId());
      request.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100)); };
      request.onerror = () => reject(new ApiError("request", "网络连接失败", 0, null));
      request.onload = () => {
        const requestId = request.getResponseHeader("x-request-id");
        if (request.status >= 200 && request.status < 300) { onProgress(100); resolve(request.response as T); return; }
        const kind: ApiErrorKind = request.status === 401 ? "unauthorized" : request.status === 403 ? "forbidden" : request.status === 409 ? "conflict" : "request";
        if (kind === "unauthorized") options.onUnauthorized?.("/api/projects/import");
        reject(new ApiError(kind, request.response?.error ?? `请求失败 (${request.status})`, request.status, requestId));
      };
      request.send(file);
    });
  }

  async function exportProject(projectId: string): Promise<void> {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/export`, { credentials: "same-origin", headers: { "x-request-id": createRequestId() } });
    if (!response.ok) {
      const kind: ApiErrorKind = response.status === 401 ? "unauthorized" : response.status === 403 ? "forbidden" : response.status === 409 ? "conflict" : "request";
      throw new ApiError(kind, `请求失败 (${response.status})`, response.status, response.headers.get("x-request-id"));
    }
    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") ?? "";
    const filename = disposition.match(/filename="([a-zA-Z0-9._-]+)"/)?.[1] ?? `project-${projectId}.sync.zip`;
    const url = URL.createObjectURL(blob), anchor = document.createElement("a");
    anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
  }

  return { request, importProject, exportProject };
}

export type ApiClient = Pick<ReturnType<typeof createApiClient>, "request"> & Partial<Pick<ReturnType<typeof createApiClient>, "importProject" | "exportProject">>;
