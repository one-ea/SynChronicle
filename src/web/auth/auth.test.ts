import argon2 from "argon2";
import Fastify from "fastify";
import { beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "../../db/client.js";
import { hashPassword, verifyPassword } from "./password.js";
import { authPlugin } from "./plugin.js";
import {
  buildActiveSessionQuery,
  type AuthRepository,
  type AuthUser,
  type StoredSession,
} from "./session.js";

class MemoryAuthRepository implements AuthRepository {
  readonly users = new Map<string, AuthUser>();
  readonly sessions = new Map<string, StoredSession>();
  readonly sessionDigests: string[] = [];

  async findUserByUsername(username: string): Promise<AuthUser | undefined> {
    return [...this.users.values()].find((user) => user.username === username);
  }

  async findUserById(userId: string): Promise<AuthUser | undefined> {
    return this.users.get(userId);
  }

  async insertSession(input: {
    userId: string;
    tokenDigest: string;
    expiresAt: Date;
  }): Promise<{ id: string }> {
    const id = `session-${this.sessions.size + 1}`;
    this.sessionDigests.push(input.tokenDigest);
    this.sessions.set(id, { id, ...input, revokedAt: null });
    return { id };
  }

  async findActiveSessionByDigest(tokenDigest: string, now: Date): Promise<StoredSession | undefined> {
    return [...this.sessions.values()].find(
      (session) =>
        session.tokenDigest === tokenDigest && session.revokedAt === null && session.expiresAt > now,
    );
  }

  async revokeSession(sessionId: string, revokedAt: Date): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) session.revokedAt = revokedAt;
  }

  async updatePasswordAndRevokeSessions(userId: string, passwordHash: string, revokedAt: Date): Promise<void> {
    const user = this.users.get(userId);
    if (user) user.passwordHash = passwordHash;
    for (const session of this.sessions.values()) {
      if (session.userId === userId && session.revokedAt === null) session.revokedAt = revokedAt;
    }
  }
}

let fixturePasswordHash = "";

beforeAll(async () => {
  fixturePasswordHash = await hashPassword("correct horse battery staple");
});

async function authenticatedTestApp() {
  const repository = new MemoryAuthRepository();
  const app = Fastify();
  await app.register(authPlugin, {
    repository,
    publicUrl: "https://app.example.test",
    loginRateLimit: { max: 2, windowMs: 60_000 },
  });
  await app.after();
  return { app, repository };
}

async function addUser(repository: MemoryAuthRepository, overrides: Partial<AuthUser> = {}) {
  const user: AuthUser = {
    id: "user-1",
    username: "alice",
    passwordHash: fixturePasswordHash,
    role: "user",
    status: "active",
    ...overrides,
  };
  repository.users.set(user.id, user);
  return user;
}

describe("password authentication", () => {
  it("queries sessions by digest while excluding revoked and expired rows", () => {
    const now = new Date("2026-07-15T00:00:00.000Z");
    const query = buildActiveSessionQuery(
      createDatabase("postgres://test:test@localhost/test"),
      "a".repeat(64),
      now,
    ).toSQL();

    expect(query.sql).toContain('"sessions"."token_digest" = $1');
    expect(query.sql).toContain('"sessions"."revoked_at" is null');
    expect(query.sql).toContain('"sessions"."expires_at" > $2');
    expect(query.sql).toContain("limit $3");
    expect(query.params).toEqual(["a".repeat(64), now.toISOString(), 1]);
  });

  it("creates and verifies a real Argon2id hash", async () => {
    const hash = await hashPassword("correct horse battery staple");

    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await argon2.verify(hash, "correct horse battery staple")).toBe(true);
    expect(await verifyPassword(hash, "wrong password")).toBe(false);
  }, 20_000);

  it("logs in with an opaque cookie whose SHA-256 digest is stored and revokes it on logout", async () => {
    const { app, repository } = await authenticatedTestApp();
    await addUser(repository);

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: "https://app.example.test" },
      payload: { username: "alice", password: "correct horse battery staple" },
    });

    expect(login.statusCode).toBe(200);
    const cookie = login.cookies.find((item) => item.name === "synchronicle_session");
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("Strict");
    expect(repository.sessionDigests[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(repository.sessionDigests[0]).not.toBe(cookie?.value);

    const logout = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { origin: "https://app.example.test" },
      cookies: { synchronicle_session: cookie!.value },
    });
    expect(logout.statusCode).toBe(204);
    expect([...repository.sessions.values()][0]?.revokedAt).toBeInstanceOf(Date);
    await app.close();
  }, 20_000);

  it("decorates authenticated requests and rejects inactive or invalid sessions uniformly", async () => {
    const { app, repository } = await authenticatedTestApp();
    await addUser(repository);
    app.get("/protected", { preHandler: app.authenticateRequest }, async (request) => request.auth);

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: "https://app.example.test" },
      payload: { username: "alice", password: "correct horse battery staple" },
    });
    const token = login.cookies[0]!.value;
    const authenticated = await app.inject({
      method: "GET",
      url: "/protected",
      cookies: { synchronicle_session: token },
    });
    expect(authenticated.json()).toEqual({ userId: "user-1", role: "user", sessionId: "session-1" });

    repository.users.get("user-1")!.status = "suspended";
    const inactive = await app.inject({ method: "GET", url: "/protected", cookies: { synchronicle_session: token } });
    const invalid = await app.inject({ method: "GET", url: "/protected", cookies: { synchronicle_session: "invalid" } });
    expect(inactive.statusCode).toBe(401);
    expect(invalid.statusCode).toBe(401);
    expect(inactive.json()).toEqual({ error: "Unauthorized" });
    expect(invalid.json()).toEqual({ error: "Unauthorized" });
    await app.close();
  }, 20_000);

  it("changes the password and revokes every user session", async () => {
    const { app, repository } = await authenticatedTestApp();
    await addUser(repository);
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: "https://app.example.test" },
      payload: { username: "alice", password: "correct horse battery staple" },
    });
    const token = login.cookies[0]!.value;

    const changed = await app.inject({
      method: "POST",
      url: "/api/auth/password",
      headers: { origin: "https://app.example.test" },
      cookies: { synchronicle_session: token },
      payload: { currentPassword: "correct horse battery staple", newPassword: "a newer secure passphrase" },
    });

    expect(changed.statusCode).toBe(204);
    expect(await verifyPassword(repository.users.get("user-1")!.passwordHash, "a newer secure passphrase")).toBe(true);
    expect([...repository.sessions.values()].every((session) => session.revokedAt instanceof Date)).toBe(true);
    await app.close();
  }, 20_000);

  it("checks mutation origins and limits repeated login attempts", async () => {
    const { app, repository } = await authenticatedTestApp();
    await addUser(repository);

    const crossOrigin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: "https://attacker.example" },
      payload: { username: "alice", password: "wrong" },
    });
    expect(crossOrigin.statusCode).toBe(403);

    const attempt = () => app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: "https://app.example.test", "x-forwarded-for": "203.0.113.7" },
      payload: { username: "alice", password: "wrong" },
    });
    expect((await attempt()).statusCode).toBe(401);
    expect((await attempt()).statusCode).toBe(401);
    expect((await attempt()).statusCode).toBe(429);
    await app.close();
  }, 20_000);
});
