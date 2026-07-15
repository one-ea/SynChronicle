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
  loginRateLimit?: { max: number; windowMs: number };
}

const mutationMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const authPlugin = fp<AuthPluginOptions>(async (app, options) => {
  const repository = options.repository ?? (options.db ? createAuthRepository(options.db) : undefined);
  if (!repository) throw new Error("Auth plugin requires a database or repository");

  const publicUrl = new URL(options.publicUrl);
  const rateLimit = options.loginRateLimit ?? { max: 10, windowMs: 60_000 };
  const attempts = new Map<string, { count: number; resetAt: number }>();

  await app.register(cookie);
  app.decorateRequest("auth");
  app.decorate("authPublicUrl", publicUrl);
  app.decorate("authenticateRequest", async function authenticateRequest(request, reply) {
    const token = request.cookies[SESSION_COOKIE];
    const session = token
      ? await repository.findActiveSessionByDigest(digestSessionToken(token), new Date())
      : undefined;
    const user = session ? await repository.findUserById(session.userId) : undefined;
    if (!session || !user || user.status !== "active") {
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
    const now = Date.now();
    const current = attempts.get(ip);
    if (!current || current.resetAt <= now) {
      attempts.set(ip, { count: 1, resetAt: now + rateLimit.windowMs });
      return true;
    }
    if (current.count >= rateLimit.max) return false;
    current.count += 1;
    return true;
  }

  await app.register(authRoutes, { prefix: "/api/auth", repository, consumeLoginAttempt });
}, { name: "synchronicle-auth" });
