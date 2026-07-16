import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import { z } from "zod";
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from "./password.js";
import { createSession, type AuthRepository } from "./session.js";
import type { AuditRepositoryLike } from "../audit/repository.js";

export const SESSION_COOKIE = "synchronicle_session";
const unauthorizedBody = { error: "Unauthorized" } as const;

const LoginBody = z.object({
  username: z.string().min(1).max(128),
  password: z.string().min(1).max(1024),
});

const PasswordBody = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: z.string().min(12).max(1024),
});

export interface AuthRoutesOptions {
  repository: AuthRepository;
  consumeLoginAttempt(ip: string): boolean;
  audit?: AuditRepositoryLike;
}

export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (app, options) => {
  const audit = async (request: FastifyRequest, event: { actorId: string | null; action: string; targetId: string | null; result: "success" | "invalid" | "error"; metadata?: Record<string, unknown> }) => {
    if (!options.audit) return;
    try { await options.audit.write({ ...event, targetType: "user", requestId: request.id, metadata: { ...event.metadata, ip: request.ip, time: new Date().toISOString() } }); }
    catch (error) { request.log.error({ err: error, action: event.action, requestId: request.id }, "auth audit write failed"); }
  };
  app.post("/login", async (request, reply) => {
    if (!options.consumeLoginAttempt(request.ip)) {
      return reply.code(429).send({ error: "Too Many Requests" });
    }

    const parsed = LoginBody.safeParse(request.body);
    const user = parsed.success ? await options.repository.findUserByUsername(parsed.data.username) : undefined;
    const password = parsed.success ? parsed.data.password : "";
    const valid = await verifyPassword(user?.passwordHash ?? DUMMY_PASSWORD_HASH, password);
    if (!user || !valid || user.status !== "active") {
      await audit(request, { actorId: user?.id ?? null, action: "auth.login", targetId: user?.id ?? null, result: "invalid", metadata: user ? {} : { usernameHash: createHash("sha256").update(parsed.success ? parsed.data.username : "invalid").digest("hex") } });
      return reply.code(401).send(unauthorizedBody);
    }

    const session = await createSession(options.repository, {
      userId: user.id,
      passwordHash: user.passwordHash,
      authVersion: user.authVersion,
    });
    if (!session) return reply.code(401).send(unauthorizedBody);
    await audit(request, { actorId: user.id, action: "auth.login", targetId: user.id, result: "success" });
    reply.setCookie(SESSION_COOKIE, session.token, {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure: app.authPublicUrl.protocol === "https:",
      expires: session.expiresAt,
    });
    return reply.code(200).send({ user: { id: user.id, username: user.username, role: user.role } });
  });

  app.post("/logout", { preHandler: app.authenticateRequest }, async (request, reply) => {
    await options.repository.revokeSession(request.auth.sessionId, new Date());
    await audit(request, { actorId: request.auth.userId, action: "auth.logout", targetId: request.auth.userId, result: "success" });
    reply.clearCookie(SESSION_COOKIE, { path: "/", httpOnly: true, sameSite: "strict", secure: app.authPublicUrl.protocol === "https:" });
    return reply.code(204).send();
  });

  app.post("/password", { preHandler: app.authenticateRequest }, async (request, reply) => {
    const parsed = PasswordBody.safeParse(request.body);
    const user = await options.repository.findUserById(request.auth.userId);
    const valid = parsed.success && user
      ? await verifyPassword(user.passwordHash, parsed.data.currentPassword)
      : false;
    if (!parsed.success || !user || !valid || user.status !== "active") {
      await audit(request, { actorId: request.auth.userId, action: "auth.password.change", targetId: request.auth.userId, result: "invalid" });
      return reply.code(401).send(unauthorizedBody);
    }

    const passwordHash = await hashPassword(parsed.data.newPassword);
    const changed = await options.repository.updatePasswordAndRevokeSessions(
      user.id,
      passwordHash,
      user.passwordHash,
      user.authVersion,
      new Date(),
    );
    if (!changed) { await audit(request, { actorId: request.auth.userId, action: "auth.password.change", targetId: request.auth.userId, result: "invalid" }); return reply.code(401).send(unauthorizedBody); }
    await audit(request, { actorId: request.auth.userId, action: "auth.password.change", targetId: request.auth.userId, result: "success" });
    reply.clearCookie(SESSION_COOKIE, { path: "/", httpOnly: true, sameSite: "strict", secure: app.authPublicUrl.protocol === "https:" });
    return reply.code(204).send();
  });
};
