import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { sessions, users } from "../../db/schema/index.js";

export type AuthRole = "user" | "admin";
export type AuthUserStatus = "active" | "suspended" | "disabled";

export interface AuthUser {
  id: string;
  username: string;
  passwordHash: string;
  authVersion: number;
  role: AuthRole;
  status: AuthUserStatus;
}

export interface StoredSession {
  id: string;
  userId: string;
  tokenDigest: string;
  authVersion: number;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface AuthRepository {
  findUserByUsername(username: string): Promise<AuthUser | undefined>;
  findUserById(userId: string): Promise<AuthUser | undefined>;
  createSessionIfCurrent(input: {
    userId: string;
    passwordHash: string;
    authVersion: number;
    tokenDigest: string;
    expiresAt: Date;
  }): Promise<{ id: string } | undefined>;
  findActiveSessionByDigest(tokenDigest: string, now: Date): Promise<StoredSession | undefined>;
  revokeSession(sessionId: string, revokedAt: Date): Promise<void>;
  updatePasswordAndRevokeSessions(
    userId: string,
    passwordHash: string,
    expectedPasswordHash: string,
    expectedAuthVersion: number,
    revokedAt: Date,
  ): Promise<boolean>;
}

export function digestSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface SessionCredentials {
  userId: string;
  passwordHash: string;
  authVersion: number;
}

export function createSession(db: Database, credentials: SessionCredentials): Promise<{ id: string; token: string; expiresAt: Date } | undefined>;
export function createSession(
  repository: Pick<AuthRepository, "createSessionIfCurrent">,
  credentials: SessionCredentials,
): Promise<{ id: string; token: string; expiresAt: Date } | undefined>;
export async function createSession(
  source: Database | Pick<AuthRepository, "createSessionIfCurrent">,
  credentials: SessionCredentials,
): Promise<{ id: string; token: string; expiresAt: Date } | undefined> {
  const repository = "createSessionIfCurrent" in source ? source : createAuthRepository(source);
  const token = randomBytes(32).toString("base64url");
  const tokenDigest = digestSessionToken(token);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const session = await repository.createSessionIfCurrent({ ...credentials, tokenDigest, expiresAt });
  if (!session) return undefined;
  return { id: session.id, token, expiresAt };
}

export function buildActiveSessionQuery(db: Database, tokenDigest: string, now: Date) {
  return db
    .select({
      id: sessions.id,
      userId: sessions.userId,
      tokenDigest: sessions.tokenDigest,
      authVersion: sessions.authVersion,
      expiresAt: sessions.expiresAt,
      revokedAt: sessions.revokedAt,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(
        eq(sessions.tokenDigest, tokenDigest),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, now),
        eq(sessions.authVersion, users.authVersion),
      ),
    )
    .limit(1);
}

export function buildCurrentCredentialsQuery(
  db: Pick<Database, "select">,
  input: { userId: string; passwordHash: string; authVersion: number },
) {
  return db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.id, input.userId),
        eq(users.passwordHash, input.passwordHash),
        eq(users.authVersion, input.authVersion),
        eq(users.status, "active"),
      ),
    )
    .for("update")
    .limit(1);
}

export function createAuthRepository(db: Database): AuthRepository {
  const userSelection = {
    id: users.id,
    username: users.username,
    passwordHash: users.passwordHash,
    authVersion: users.authVersion,
    role: users.role,
    status: users.status,
  };

  return {
    async findUserByUsername(username) {
      const [user] = await db.select(userSelection).from(users).where(eq(users.username, username)).limit(1);
      return user;
    },
    async findUserById(userId) {
      const [user] = await db.select(userSelection).from(users).where(eq(users.id, userId)).limit(1);
      return user;
    },
    async createSessionIfCurrent(input) {
      return db.transaction(async (transaction) => {
        const [current] = await buildCurrentCredentialsQuery(transaction, input);
        if (!current) return undefined;
        const [session] = await transaction
          .insert(sessions)
          .values({
            userId: input.userId,
            tokenDigest: input.tokenDigest,
            authVersion: input.authVersion,
            expiresAt: input.expiresAt,
          })
          .returning({ id: sessions.id });
        if (!session) throw new Error("Session insert returned no row");
        return session;
      });
    },
    async findActiveSessionByDigest(tokenDigest, now) {
      const [session] = await buildActiveSessionQuery(db, tokenDigest, now);
      return session;
    },
    async revokeSession(sessionId, revokedAt) {
      await db
        .update(sessions)
        .set({ revokedAt })
        .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
    },
    async updatePasswordAndRevokeSessions(userId, passwordHash, expectedPasswordHash, expectedAuthVersion, revokedAt) {
      return db.transaction(async (transaction) => {
        const [updated] = await transaction
          .update(users)
          .set({
            passwordHash,
            authVersion: sql`${users.authVersion} + 1`,
            updatedAt: revokedAt,
          })
          .where(
            and(
              eq(users.id, userId),
              eq(users.passwordHash, expectedPasswordHash),
              eq(users.authVersion, expectedAuthVersion),
            ),
          )
          .returning({ id: users.id });
        if (!updated) return false;
        await transaction
          .update(sessions)
          .set({ revokedAt })
          .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
        return true;
      });
    },
  };
}
