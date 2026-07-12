type JsonObject = Record<string, unknown>;

type Extra = JsonObject & { headers?: Record<string, string> };

export function withExtra(fetchImpl: typeof fetch, extraBody?: JsonObject, extra?: Extra): typeof fetch {
  return async (input, init = {}) => {
    const headers = new Headers(init.headers);
    for (const [key, value] of Object.entries(extra?.headers ?? {})) headers.set(key, value);
    let body = init.body;
    if (extraBody && typeof body === "string") body = JSON.stringify({ ...JSON.parse(body), ...extraBody });
    return fetchImpl(input, { ...init, headers, body });
  };
}
