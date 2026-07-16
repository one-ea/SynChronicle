import { randomBytes } from "node:crypto";
import { Transform } from "node:stream";
import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import { redactSecrets } from "../../credentials/redactor.js";

const mutationMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

interface RateLimitRule {
  max: number;
  windowMs: number;
}

export interface ProductionSecurityOptions {
  publicUrl: string;
  maxBodyBytes?: number;
  bodyLimits?: {
    default: number;
    routes?: Record<string, number>;
  };
  rateLimits?: {
    default?: RateLimitRule;
    routes?: Record<string, RateLimitRule>;
  };
}

interface RateEntry {
  count: number;
  resetAt: number;
}

declare module "fastify" {
  interface FastifyRequest {
    securityNonce: string;
  }
}

function validateRule(rule: RateLimitRule): void {
  if (!Number.isSafeInteger(rule.max) || rule.max < 1) throw new Error("rate limit max must be a positive integer");
  if (!Number.isSafeInteger(rule.windowMs) || rule.windowMs < 1) throw new Error("rate limit windowMs must be a positive integer");
}

function routeKey(method: string, url: string): string {
  return `${method}:${url.split("?", 1)[0]}`;
}

function csp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self' ws: wss:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

const plugin: FastifyPluginAsync<ProductionSecurityOptions> = async (app, options) => {
  const publicOrigin = new URL(options.publicUrl).origin;
  const secureDeployment = new URL(options.publicUrl).protocol === "https:";
  const defaultBodyLimit = options.bodyLimits?.default ?? options.maxBodyBytes ?? 1024 * 1024;
  const routeBodyLimits = options.bodyLimits?.routes ?? {};
  const defaultRateLimit = options.rateLimits?.default ?? { max: 300, windowMs: 60_000 };
  const routeLimits = options.rateLimits?.routes ?? {};
  validateRule(defaultRateLimit);
  Object.values(routeLimits).forEach(validateRule);
  for (const limit of [defaultBodyLimit, ...Object.values(routeBodyLimits)]) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("body limits must be positive integers");
  }

  const attempts = new Map<string, RateEntry>();
  const userAttempts = new Map<string, RateEntry>();
  app.decorateRequest("securityNonce", "");

  app.addHook("onRequest", async (request, reply) => {
    request.securityNonce = randomBytes(18).toString("base64url");
    const maxBodyBytes = routeBodyLimits[routeKey(request.method, request.url)] ?? defaultBodyLimit;
    const contentLength = Number(request.headers["content-length"] ?? 0);
    if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
      return reply.code(413).send({ error: "Payload Too Large", requestId: request.id });
    }
    if (mutationMethods.has(request.method) && request.headers.origin !== publicOrigin) {
      return reply.code(403).send({ error: "Forbidden", requestId: request.id });
    }
    if (request.url.startsWith("/api/health/")) return;

    const key = routeKey(request.method, request.url);
    const rule = routeLimits[key] ?? defaultRateLimit;
    const bucketKey = `${key}:ip:${request.ip}`;
    const now = Date.now();
    for (const [candidate, entry] of attempts) if (entry.resetAt <= now) attempts.delete(candidate);
    const current = attempts.get(bucketKey);
    if (!current || current.resetAt <= now) {
      attempts.set(bucketKey, { count: 1, resetAt: now + rule.windowMs });
      return;
    }
    if (current.count >= rule.max) {
      reply.header("retry-after", String(Math.max(1, Math.ceil((current.resetAt - now) / 1000))));
      return reply.code(429).send({ error: "Too Many Requests", requestId: request.id });
    }
    current.count += 1;
  });

  app.addHook("preParsing", async (request, reply, payload) => {
    if (!mutationMethods.has(request.method) || reply.sent) return payload;
    const maxBodyBytes = routeBodyLimits[routeKey(request.method, request.url)] ?? defaultBodyLimit;
    let size = 0;
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.byteLength;
        if (size > maxBodyBytes) callback(Object.assign(new Error("Payload Too Large"), { statusCode: 413 }));
        else callback(null, chunk);
      },
    });
    return payload.pipe(limiter);
  });

  app.addHook("preHandler", async (request, reply) => {
    const protectedApi = request.url.startsWith("/api/") && !request.url.startsWith("/api/auth/") && !request.url.startsWith("/api/health");
    if (!protectedApi) return;
    await app.authenticateRequest(request, reply);
    if (reply.sent) return;
    if (request.url.startsWith("/api/admin/") && request.auth.role !== "admin") return reply.code(403).send({ error: "Forbidden", requestId: request.id });

    const key = routeKey(request.method, request.url);
    const rule = routeLimits[key] ?? defaultRateLimit;
    const bucketKey = `${key}:user:${request.auth.userId}`;
    const now = Date.now();
    for (const [candidate, entry] of userAttempts) if (entry.resetAt <= now) userAttempts.delete(candidate);
    const current = userAttempts.get(bucketKey);
    if (!current || current.resetAt <= now) {
      userAttempts.set(bucketKey, { count: 1, resetAt: now + rule.windowMs });
      return;
    }
    if (current.count >= rule.max) {
      reply.header("retry-after", String(Math.max(1, Math.ceil((current.resetAt - now) / 1000))));
      return reply.code(429).send({ error: "Too Many Requests", requestId: request.id });
    }
    current.count += 1;
  });

  app.addHook("onSend", async (request, reply) => {
    reply.header("content-security-policy", csp(request.securityNonce));
    if (secureDeployment) reply.header("strict-transport-security", "max-age=31536000; includeSubDomains");
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    reply.header("referrer-policy", "no-referrer");
    reply.header("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error(redactSecrets(error), "request failed");
    const candidate = error && typeof error === "object" && "statusCode" in error ? Number(error.statusCode) : 500;
    const statusCode = Number.isInteger(candidate) && candidate >= 400 && candidate < 500 ? candidate : 500;
    const message = statusCode === 413 ? "Payload Too Large" : statusCode === 429 ? "Too Many Requests" : statusCode < 500 ? "Invalid request" : "Internal Server Error";
    void reply.code(statusCode).send({ error: message, requestId: request.id });
  });
};

export const productionSecurityPlugin = fp(plugin, { name: "synchronicle-production-security" });
