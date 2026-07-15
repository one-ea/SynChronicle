import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { sessions, users } from "../../db/schema/index.js";

export type AuthRole = "user" | "admin";
export type AuthUserStatus = "active" | "suspended" | "disabled";

export interface AuthUser {
  id: string;
  username: string;
  passwordHash: string;
  role: AuthRole;
  status: AuthUserStatus;
}

export interface StoredSession {
  id: string;
  userId: string;
  tokenDigest: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface AuthRepository {
  findUserByUsername(username: string): Promise<AuthUser | undefined>;
  findUserById(userId: string): Promise<AuthUser | undefined>;
  insertSession(input: { userId: string; tokenDigest: string; expiresAt: Date }): Promise<{ id: string }>;
  findActiveSessionByDigest(tokenDigest: string, now: Date): Promise<StoredSession | undefined>;
  revokeSession(sessionId: string, revokedAt: Date): Promise<void>;
  updatePasswordAndRevokeSessions(userId: string, passwordHash: string, revokedAt: Date): Promise<void>;
}

export function digestSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createSession(db: Database, userId: string): Promise<{ id: string; token: string; expiresAt: Date }>;
export function createSession(
  repository: Pick<AuthRepository, "insertSession">,
  userId: string,
): Promise<{ id: string; token: string; expiresAt: Date }>;
export async function createSession(
  source: Database | Pick<AuthRepository, "insertSession">,
  userId: string,
): Promise<{ id: string; token: string; expiresAt: Date }> {
  const repository = "insertSession" in source ? source : createAuthRepository(source);
  const token = randomBytes(32).toString("base64url");
  const tokenDigest = digestSessionToken(token);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const session = await repository.insertSession({ userId, tokenDigest, expiresAt });
  return { id: session.id, token, expiresAt };
}

export function buildActiveSessionQuery(db: Database, tokenDigest: string, now: Date) {
  return db
    .select({
      id: sessions.id,
      userId: sessions.userId,
      tokenDigest: sessions.tokenDigest,
      expiresAt: sessions.expiresAt,
      revokedAt: sessions.revokedAt,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.tokenDigest, tokenDigest),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, now),
      ),
    )
    .limit(1);
}

export function createAuthRepository(db: Database): AuthRepository {
  const userSelection = {
    id: users.id,
    username: users.username,
    passwordHash: users.passwordHash,
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
    async insertSession(input) {
      const [session] = await db.insert(sessions).values(input).returning({ id: sessions.id });
      if (!session) throw new Error("Session insert returned no row");
      return session;
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
    async updatePasswordAndRevokeSessions(userId, passwordHash, revokedAt) {
      await db.transaction(async (transaction) => {
        await transaction
          .update(users)
          .set({ passwordHash, updatedAt: revokedAt })
          .where(eq(users.id, userId));
        await transaction
          .update(sessions)
          .set({ revokedAt })
          .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
      });
    },
  };
}
