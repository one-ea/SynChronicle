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
  onUnauthorized?: () => void;
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
      if (kind === "unauthorized") options.onUnauthorized?.();
      throw new ApiError(kind, `请求失败 (${response.status})`, response.status, requestId);
    }
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  }

  return { request };
}

export type ApiClient = ReturnType<typeof createApiClient>;
