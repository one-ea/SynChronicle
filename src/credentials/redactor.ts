const secretKey = /^(?:.*[-_])?api[-_]?key$|^(authorization|proxy-authorization|token|access[-_]?token|refresh[-_]?token|password|secret|cookie|set-cookie|credential[-_]?id)$/i;
const secretQuery = /^(api[-_]?key|key|token|access[-_]?token|authorization|secret)$/i;

function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    for (const name of [...url.searchParams.keys()]) if (secretQuery.test(name)) url.searchParams.set(name, "[REDACTED]");
    return url.toString();
  } catch {
    return value
      .replace(/((?:api[-_]?key|token|authorization|secret)\s*[:=]\s*)[^&,\s]+/gi, "$1[REDACTED]")
      .replace(/(Bearer\s+)[^\s,]+/gi, "$1[REDACTED]")
      .replace(/(secret(?:\s+value)?\s*[:=-]\s*)[^\s,]+/gi, "$1[REDACTED]");
  }
}

export function redactSecrets<T>(value: T, seen = new WeakMap<object, unknown>()): T {
  if (typeof value === "string") return redactUrl(value) as T;
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return seen.get(value) as T;
  if (value instanceof Headers) {
    const headers: Record<string, string> = {};
    value.forEach((entry, name) => { headers[name] = secretKey.test(name) ? "[REDACTED]" : redactUrl(entry); });
    return headers as T;
  }
  if (value instanceof Error) {
    const copy = { name: value.name, message: redactUrl(value.message), ...(value.cause === undefined ? {} : { cause: redactSecrets(value.cause, seen) }) };
    seen.set(value, copy);
    return copy as T;
  }
  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    seen.set(value, copy);
    value.forEach((entry) => copy.push(redactSecrets(entry, seen)));
    return copy as T;
  }
  const copy: Record<string, unknown> = {};
  seen.set(value, copy);
  for (const [name, entry] of Object.entries(value)) copy[name] = secretKey.test(name) ? "[REDACTED]" : redactSecrets(entry, seen);
  return copy as T;
}
