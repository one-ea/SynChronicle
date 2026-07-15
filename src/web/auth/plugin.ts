import cookie from "@fastify/cookie";
import fp from "fastify-plugin";
import { authRoutes, SESSION_COOKIE } from "./routes.js";
import {
  createAuthRepository,
  digestSessionToken,
  type AuthRepository,
  type AuthRole,
} from "./session.js";
import type { Database } from "../../db/client.js";

export interface RequestAuth {
  userId: string;
  role: AuthRole;
  sessionId: string;
}

declare module "fastify" {
  interface FastifyRequest {
    auth: RequestAuth;
  }

  interface FastifyInstance {
    authenticateRequest(
      request: import("fastify").FastifyRequest,
      reply: import("fastify").FastifyReply,
    ): Promise<void>;
    authPublicUrl: URL;
  }
}

export interface AuthPluginOptions {
  db?: Database;
  repository?: AuthRepository;
  publicUrl: string;
  loginRateLimit?: { max: number; windowMs: number; capacity?: number };
}

const mutationMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface LoginRateLimiter {
  consume(key: string): boolean;
  readonly size: number;
}

export function createLoginRateLimiter(
  options: { max: number; windowMs: number; capacity?: number },
  now: () => number = Date.now,
): LoginRateLimiter {
  const capacity = options.capacity ?? 10_000;
  for (const [name, value] of [["max", options.max], ["windowMs", options.windowMs], ["capacity", capacity]] as const) {
    if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  }
  const attempts = new Map<string, { count: number; resetAt: number }>();

  return {
    consume(key) {
      const timestamp = now();
      for (const [candidate, attempt] of attempts) {
        if (attempt.resetAt <= timestamp) attempts.delete(candidate);
      }
      const current = attempts.get(key);
      if (!current) {
        if (attempts.size >= capacity) return false;
        attempts.set(key, { count: 1, resetAt: timestamp + options.windowMs });
        return true;
      }
      if (current.count >= options.max) return false;
      current.count += 1;
      return true;
    },
    get size() {
      return attempts.size;
    },
  };
}

export const authPlugin = fp<AuthPluginOptions>(async (app, options) => {
  const repository = options.repository ?? (options.db ? createAuthRepository(options.db) : undefined);
  if (!repository) throw new Error("Auth plugin requires a database or repository");

  const publicUrl = new URL(options.publicUrl);
  const rateLimit = options.loginRateLimit ?? { max: 10, windowMs: 60_000 };
  const limiter = createLoginRateLimiter(rateLimit);

  await app.register(cookie);
  app.decorateRequest("auth");
  app.decorate("authPublicUrl", publicUrl);
  app.decorate("authenticateRequest", async function authenticateRequest(request, reply) {
    const token = request.cookies[SESSION_COOKIE];
    const session = token
      ? await repository.findActiveSessionByDigest(digestSessionToken(token), new Date())
      : undefined;
    const user = session ? await repository.findUserById(session.userId) : undefined;
    if (!session || !user || user.status !== "active" || session.authVersion !== user.authVersion) {
      await reply.code(401).send({ error: "Unauthorized" });
      return;
    }
    request.auth = { userId: user.id, role: user.role, sessionId: session.id };
  });

  app.addHook("onRequest", async (request, reply) => {
    if (!mutationMethods.has(request.method)) return;
    const origin = request.headers.origin;
    if (origin !== publicUrl.origin) {
      await reply.code(403).send({ error: "Forbidden" });
    }
  });

  function consumeLoginAttempt(ip: string): boolean {
    return limiter.consume(ip);
  }

  await app.register(authRoutes, { prefix: "/api/auth", repository, consumeLoginAttempt });
}, { name: "synchronicle-auth" });
