import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { chmod } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { FileIO } from "../store/io.js";
import { UsersFileSchema, type UserRecord, type UsersFile } from "../domain/user.js";

const USERS_PATH = "users.json";
const SECRET_PATH = ".auth_secret";
const SESSION_SECONDS = 7 * 24 * 60 * 60;

export interface SessionUser { id: string; name: string; role: "admin" | "writer"; }

export function hashPassword(password: string, salt = randomBytes(16).toString("hex")): { salt: string; hash: string } {
  return { salt, hash: scryptSync(password, salt, 64).toString("hex") };
}

export function verifyPassword(password: string, salt: string, expected: string): boolean {
  const actual = scryptSync(password, salt, 64);
  const target = Buffer.from(expected, "hex");
  return target.length === actual.length && timingSafeEqual(actual, target);
}

export function issueToken(uid: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const payload = Buffer.from(JSON.stringify({ uid, exp: nowSeconds + SESSION_SECONDS })).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyToken(token: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): { uid: string; exp: number } | null {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  const actual = Buffer.from(signature, "hex");
  const expected = Buffer.from(sign(payload, secret), "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { uid?: unknown; exp?: unknown };
    if (typeof value.uid !== "string" || typeof value.exp !== "number" || value.exp <= nowSeconds) return null;
    return { uid: value.uid, exp: value.exp };
  } catch { return null; }
}

export function parseCookie(header: string | undefined, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return null;
}

export class LoginRateLimiter {
  private readonly entries = new Map<string, { fails: number; lockUntil: number }>();
  constructor(private readonly maxFails = 5, private readonly lockMs = 15 * 60_000) {}
  isLocked(key: string, now = Date.now()): boolean { return (this.entries.get(key)?.lockUntil ?? 0) > now; }
  fail(key: string, now = Date.now()): void {
    const entry = this.entries.get(key) ?? { fails: 0, lockUntil: 0 };
    entry.fails += 1;
    if (entry.fails >= this.maxFails) entry.lockUntil = now + this.lockMs;
    this.entries.set(key, entry);
  }
  success(key: string): void { this.entries.delete(key); }
}

export class AuthStore {
  private readonly io: FileIO;
  constructor(readonly root: string) { this.io = new FileIO(root); }

  async loadUsers(): Promise<UsersFile> {
    const raw = await this.io.readJSON<unknown>(USERS_PATH);
    const parsed = raw ? UsersFileSchema.safeParse(raw) : null;
    return parsed?.success ? parsed.data : { users: [], updatedAt: new Date().toISOString() };
  }

  async saveUsers(users: UserRecord[]): Promise<void> {
    await this.io.writeJSON(USERS_PATH, { users, updatedAt: new Date().toISOString() });
  }

  async secret(): Promise<string> {
    const existing = (await this.io.readText(SECRET_PATH)).trim();
    if (existing) return existing;
    const secret = randomBytes(32).toString("hex");
    await this.io.writeFile(SECRET_PATH, secret);
    await chmod(this.io.path(SECRET_PATH), 0o600);
    return secret;
  }
}

export async function authenticate(request: IncomingMessage, store: AuthStore): Promise<SessionUser | null> {
  const token = parseCookie(request.headers.cookie, "sc_token");
  if (!token) return null;
  const payload = verifyToken(token, await store.secret());
  if (!payload) return null;
  const user = (await store.loadUsers()).users.find((candidate) => candidate.id === payload.uid && !candidate.disabled);
  return user ? { id: user.id, name: user.name, role: user.role } : null;
}

export function sessionCookie(token: string): string {
  return `sc_token=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}`;
}

export function clearSessionCookie(): string {
  return "sc_token=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0";
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}
