import argon2 from "argon2";
import Fastify from "fastify";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createDatabase } from "../../db/client.js";
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from "./password.js";
import { authPlugin, createLoginRateLimiter } from "./plugin.js";
import {
  buildActiveSessionQuery,
  buildCurrentCredentialsQuery,
  type AuthRepository,
  type AuthUser,
  type StoredSession,
} from "./session.js";

class MemoryAuthRepository implements AuthRepository {
  readonly users = new Map<string, AuthUser>();
  readonly sessions = new Map<string, StoredSession>();
  readonly sessionDigests: string[] = [];
  rejectNextSession = false;
  failPasswordUpdate = false;
  rejectNextPasswordUpdate = false;

  async findUserByUsername(username: string): Promise<AuthUser | undefined> {
    return [...this.users.values()].find((user) => user.username === username);
  }

  async findUserById(userId: string): Promise<AuthUser | undefined> {
    return this.users.get(userId);
  }

  async createSessionIfCurrent(input: {
    userId: string;
    passwordHash: string;
    authVersion: number;
    tokenDigest: string;
    expiresAt: Date;
  }): Promise<{ id: string } | undefined> {
    const user = this.users.get(input.userId);
    if (
      this.rejectNextSession ||
      !user ||
      user.passwordHash !== input.passwordHash ||
      user.authVersion !== input.authVersion
    ) {
      this.rejectNextSession = false;
      return undefined;
    }
    const id = `session-${this.sessions.size + 1}`;
    this.sessionDigests.push(input.tokenDigest);
    this.sessions.set(id, {
      id,
      userId: input.userId,
      authVersion: input.authVersion,
      tokenDigest: input.tokenDigest,
      expiresAt: input.expiresAt,
      revokedAt: null,
    });
    return { id };
  }

  async findActiveSessionByDigest(tokenDigest: string, now: Date): Promise<StoredSession | undefined> {
    return [...this.sessions.values()].find(
      (session) =>
        session.tokenDigest === tokenDigest &&
        session.revokedAt === null &&
        session.expiresAt > now &&
        session.authVersion === this.users.get(session.userId)?.authVersion,
    );
  }

  async revokeSession(sessionId: string, revokedAt: Date): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) session.revokedAt = revokedAt;
  }

  async updatePasswordAndRevokeSessions(
    userId: string,
    passwordHash: string,
    expectedPasswordHash: string,
    expectedAuthVersion: number,
    revokedAt: Date,
  ): Promise<boolean> {
    const user = this.users.get(userId);
    if (
      this.rejectNextPasswordUpdate ||
      !user ||
      user.passwordHash !== expectedPasswordHash ||
      user.authVersion !== expectedAuthVersion
    ) {
      this.rejectNextPasswordUpdate = false;
      return false;
    }
    const previousUser = user ? { ...user } : undefined;
    const previousRevocations = new Map([...this.sessions].map(([id, session]) => [id, session.revokedAt]));
    if (user) {
      user.passwordHash = passwordHash;
      user.authVersion += 1;
    }
    for (const session of this.sessions.values()) {
      if (session.userId === userId && session.revokedAt === null) session.revokedAt = revokedAt;
    }
    if (this.failPasswordUpdate) {
      if (user && previousUser) Object.assign(user, previousUser);
      for (const [id, previousRevokedAt] of previousRevocations) this.sessions.get(id)!.revokedAt = previousRevokedAt;
      throw new Error("simulated transaction failure");
    }
    return true;
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
    authVersion: 1,
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
    expect(query.sql).toContain('"sessions"."auth_version" = "users"."auth_version"');
    expect(query.sql).toContain("limit $3");
    expect(query.params).toEqual(["a".repeat(64), now.toISOString(), 1]);
  });

  it("locks and confirms unchanged active credentials before inserting a session", () => {
    const query = buildCurrentCredentialsQuery(createDatabase("postgres://test:test@localhost/test"), {
      userId: "00000000-0000-4000-8000-000000000001",
      passwordHash: "password-hash",
      authVersion: 4,
    }).toSQL();

    expect(query.sql).toContain('"users"."password_hash" =');
    expect(query.sql).toContain('"users"."auth_version" =');
    expect(query.sql).toContain('"users"."status" =');
    expect(query.sql).toContain("for update");
  });

  it("uses a fixed Argon2id dummy hash for an unknown username", async () => {
    expect(DUMMY_PASSWORD_HASH).toMatch(/^\$argon2id\$/);
    const verify = vi.spyOn(argon2, "verify");
    const { app } = await authenticatedTestApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: "https://app.example.test" },
      payload: { username: "missing", password: "unknown password" },
    });

    expect(response.statusCode).toBe(401);
    expect(verify).toHaveBeenCalledWith(DUMMY_PASSWORD_HASH, "unknown password");
    verify.mockRestore();
    await app.close();
  }, 20_000);

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
    expect(cookie?.secure).toBe(true);
    expect(cookie?.path).toBe("/");
    expect(cookie?.expires).toBeInstanceOf(Date);
    const storedSession = [...repository.sessions.values()][0]!;
    expect(cookie?.expires?.getTime()).toBe(Math.floor(storedSession.expiresAt.getTime() / 1_000) * 1_000);
    expect(storedSession.expiresAt.getTime() - Date.now()).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
    expect(storedSession.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(30 * 24 * 60 * 60 * 1000);
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
    expect(logout.headers["set-cookie"]).toContain("synchronicle_session=;");
    expect(logout.headers["set-cookie"]).toContain("Max-Age=0");
    expect(logout.headers["set-cookie"]).toContain("Path=/");
    expect(logout.headers["set-cookie"]).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
    expect(logout.headers["set-cookie"]).toContain("HttpOnly; Secure; SameSite=Strict");
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

  it("rejects revoked, expired, and authentication-version-mismatched sessions", async () => {
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
    const session = [...repository.sessions.values()][0]!;

    session.revokedAt = new Date();
    expect((await app.inject({ method: "GET", url: "/protected", cookies: { synchronicle_session: token } })).statusCode).toBe(401);
    session.revokedAt = null;
    session.expiresAt = new Date(0);
    expect((await app.inject({ method: "GET", url: "/protected", cookies: { synchronicle_session: token } })).statusCode).toBe(401);
    session.expiresAt = new Date(Date.now() + 60_000);
    repository.users.get("user-1")!.authVersion += 1;
    expect((await app.inject({ method: "GET", url: "/protected", cookies: { synchronicle_session: token } })).statusCode).toBe(401);
    await app.close();
  }, 20_000);

  it("does not create a session when credentials change after password verification", async () => {
    const { app, repository } = await authenticatedTestApp();
    await addUser(repository);
    repository.rejectNextSession = true;

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: "https://app.example.test" },
      payload: { username: "alice", password: "correct horse battery staple" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.cookies).toHaveLength(0);
    expect(repository.sessions.size).toBe(0);
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
    expect(repository.users.get("user-1")!.authVersion).toBe(2);
    expect([...repository.sessions.values()].every((session) => session.revokedAt instanceof Date)).toBe(true);
    await app.close();
  }, 20_000);

  it("preserves credentials and sessions when the password transaction rolls back", async () => {
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
    repository.failPasswordUpdate = true;

    const changed = await app.inject({
      method: "POST",
      url: "/api/auth/password",
      headers: { origin: "https://app.example.test" },
      cookies: { synchronicle_session: token },
      payload: { currentPassword: "correct horse battery staple", newPassword: "a newer secure passphrase" },
    });

    expect(changed.statusCode).toBe(500);
    expect(repository.users.get("user-1")!.authVersion).toBe(1);
    expect(await verifyPassword(repository.users.get("user-1")!.passwordHash, "correct horse battery staple")).toBe(true);
    expect((await app.inject({ method: "GET", url: "/protected", cookies: { synchronicle_session: token } })).statusCode).toBe(200);
    await app.close();
  }, 20_000);

  it("rejects a password change when another transaction changed the authentication version", async () => {
    const { app, repository } = await authenticatedTestApp();
    await addUser(repository);
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: "https://app.example.test" },
      payload: { username: "alice", password: "correct horse battery staple" },
    });
    repository.rejectNextPasswordUpdate = true;

    const changed = await app.inject({
      method: "POST",
      url: "/api/auth/password",
      headers: { origin: "https://app.example.test" },
      cookies: { synchronicle_session: login.cookies[0]!.value },
      payload: { currentPassword: "correct horse battery staple", newPassword: "a newer secure passphrase" },
    });

    expect(changed.statusCode).toBe(401);
    expect(repository.users.get("user-1")!.authVersion).toBe(1);
    expect(await verifyPassword(repository.users.get("user-1")!.passwordHash, "correct horse battery staple")).toBe(true);
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
      headers: { origin: "https://app.example.test" },
      payload: { username: "alice", password: "wrong" },
    });
    expect((await attempt()).statusCode).toBe(401);
    expect((await attempt()).statusCode).toBe(401);
    expect((await attempt()).statusCode).toBe(429);
    await app.close();
  }, 20_000);

  it("validates login limits and removes expired capacity entries", () => {
    expect(() => createLoginRateLimiter({ max: 0, windowMs: 1_000 })).toThrow();
    expect(() => createLoginRateLimiter({ max: 1, windowMs: -1 })).toThrow();

    let now = 1_000;
    const limiter = createLoginRateLimiter({ max: 1, windowMs: 100, capacity: 2 }, () => now);
    expect(limiter.consume("first")).toBe(true);
    expect(limiter.consume("second")).toBe(true);
    expect(limiter.size).toBe(2);
    now += 101;
    expect(limiter.consume("third")).toBe(true);
    expect(limiter.size).toBe(1);
  });
});
