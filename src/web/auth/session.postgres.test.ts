import crypto from "node:crypto";
import Fastify from "fastify";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../../db/client.js";
import { migrateDatabase } from "../../db/migrate.js";
import { sessions, users } from "../../db/schema/index.js";
import { hashPassword } from "./password.js";
import { authPlugin } from "./plugin.js";
import { createAuthRepository, digestSessionToken } from "./session.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const postgres = testDatabaseUrl ? describe : describe.skip;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

postgres("PostgreSQL authentication races", () => {
  let database: Database;

  beforeAll(async () => {
    database = createDatabase(testDatabaseUrl!);
    await migrateDatabase(testDatabaseUrl!);
  });

  afterAll(async () => {
    await database.$client.end();
  });

  it("rolls back password, auth version, and revocation when the transaction fails after revoking sessions", async () => {
    const suffix = crypto.randomUUID();
    const [user] = await database
      .insert(users)
      .values({ username: `rollback-${suffix}`, passwordHash: "old-hash" })
      .returning();
    const [session] = await database
      .insert(sessions)
      .values({
        userId: user!.id,
        tokenDigest: crypto.randomUUID(),
        authVersion: user!.authVersion,
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning();
    const repository = createAuthRepository(database, {
      afterPasswordSessionsRevoked() {
        throw new Error("injected after revocation");
      },
    });

    await expect(
      repository.updatePasswordAndRevokeSessions(
        user!.id,
        "new-hash",
        user!.passwordHash,
        user!.authVersion,
        new Date(),
      ),
    ).rejects.toThrow("injected after revocation");

    const [storedUser] = await database.select().from(users).where(eq(users.id, user!.id));
    const [storedSession] = await database.select().from(sessions).where(eq(sessions.id, session!.id));
    expect(storedUser).toMatchObject({ passwordHash: "old-hash", authVersion: 1 });
    expect(storedSession?.revokedAt).toBeNull();
  });

  it("leaves no active old-version session after a real concurrent login and password change", async () => {
    const suffix = crypto.randomUUID();
    const tokenDigest = crypto.randomUUID();
    const [user] = await database
      .insert(users)
      .values({ username: `login-race-${suffix}`, passwordHash: "old-hash" })
      .returning();
    const locked = deferred();
    const release = deferred();
    const loginRepository = createAuthRepository(database, {
      async afterSessionCredentialsLocked() {
        locked.resolve();
        await release.promise;
      },
    });
    const passwordRepository = createAuthRepository(database);

    const login = loginRepository.createSessionIfCurrent({
      userId: user!.id,
      passwordHash: user!.passwordHash,
      authVersion: user!.authVersion,
      tokenDigest,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await locked.promise;
    const passwordChange = passwordRepository.updatePasswordAndRevokeSessions(
      user!.id,
      "new-hash",
      user!.passwordHash,
      user!.authVersion,
      new Date(),
    );
    release.resolve();

    const [created, changed] = await Promise.all([login, passwordChange]);
    expect(created).toBeDefined();
    expect(changed).toBe(true);
    expect(await passwordRepository.findActiveSessionByDigest(tokenDigest, new Date())).toBeUndefined();
  });

  it("allows one of two concurrent password changes and returns the uniform failure response", async () => {
    const suffix = crypto.randomUUID();
    const passwordHash = await hashPassword("correct horse battery staple");
    const [user] = await database
      .insert(users)
      .values({ username: `password-race-${suffix}`, passwordHash })
      .returning();
    const tokens = [crypto.randomBytes(32).toString("base64url"), crypto.randomBytes(32).toString("base64url")];
    await database.insert(sessions).values(tokens.map((token) => ({
      userId: user!.id,
      tokenDigest: digestSessionToken(token),
      authVersion: user!.authVersion,
      expiresAt: new Date(Date.now() + 60_000),
    })));
    const app = Fastify();
    await app.register(authPlugin, {
      db: database,
      publicUrl: "https://app.example.test",
      loginRateLimit: { max: 10, windowMs: 60_000 },
    });

    try {
      const responses = await Promise.all(tokens.map((token, index) => app.inject({
        method: "POST",
        url: "/api/auth/password",
        headers: { origin: "https://app.example.test" },
        cookies: { synchronicle_session: token },
        payload: {
          currentPassword: "correct horse battery staple",
          newPassword: `new secure passphrase ${index + 1}`,
        },
      })));
      expect(responses.map((response) => response.statusCode).sort()).toEqual([204, 401]);
      expect(responses.find((response) => response.statusCode === 401)?.json()).toEqual({ error: "Unauthorized" });
      const [storedUser] = await database.select().from(users).where(eq(users.id, user!.id));
      const storedSessions = await database.select().from(sessions).where(eq(sessions.userId, user!.id));
      expect(storedUser?.authVersion).toBe(2);
      expect(storedSessions.every((session) => session.revokedAt instanceof Date)).toBe(true);
    } finally {
      await app.close();
    }
  }, 30_000);
});
