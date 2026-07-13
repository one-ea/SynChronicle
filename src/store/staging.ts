import { createHash, randomUUID } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, posix, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { FileIO, isMissing } from "./io.js";

const DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const StagedArtifactSchema = z.object({
  id: z.string().min(1),
  round: z.number().int().nonnegative(),
  target: z.string().min(1),
  contentFile: z.string().min(1),
  digest: DigestSchema,
  status: z.enum(["staged", "committing", "committed"]),
}).strict();

const ManifestSchema = z.object({
  sessionId: z.string().min(1),
  artifacts: z.array(StagedArtifactSchema),
}).strict().superRefine((manifest, context) => {
  const ids = new Set<string>();
  manifest.artifacts.forEach((artifact, index) => {
    if (ids.has(artifact.id)) context.addIssue({ code: "custom", path: ["artifacts", index, "id"], message: "工件 ID 必须唯一" });
    ids.add(artifact.id);
  });
});

export type StagedArtifact = z.infer<typeof StagedArtifactSchema>;
type Manifest = z.infer<typeof ManifestSchema>;

export interface ArtifactInput {
  target: string;
  content: string | Uint8Array;
}

export class StagedArtifactStore {
  private readonly sessions = new Map<string, Promise<StagingSession>>();

  constructor(private readonly io: FileIO) {}

  async createSession(sessionId: string = randomUUID()) {
    validateSegment(sessionId, "session");
    const cached = this.sessions.get(sessionId);
    if (cached) return cached;
    const created = StagingSession.open(this.io, sessionId);
    this.sessions.set(sessionId, created);
    created.catch(() => this.sessions.delete(sessionId));
    return created;
  }

  async saveState(sessionId: string, state: unknown) {
    validateSegment(sessionId, "session");
    await assertSafeStorePath(this.io, statePath(sessionId));
    await this.io.writeJSON(statePath(sessionId), state);
  }

  async loadState<T = unknown>(sessionId: string): Promise<T | null> {
    validateSegment(sessionId, "session");
    await assertSafeStorePath(this.io, statePath(sessionId));
    return this.io.readJSON<T>(statePath(sessionId));
  }
}

export class StagingSession {
  private static readonly locks = new Map<string, Promise<void>>();

  private constructor(private readonly io: FileIO, readonly sessionId: string) {}

  static async open(io: FileIO, sessionId: string) {
    const session = new StagingSession(io, sessionId);
    await session.withLock(async () => {
      const manifest = await session.readManifest();
      if (manifest) await session.recover(manifest);
      else await session.persist({ sessionId, artifacts: [] });
    });
    return session;
  }

  stage(round: number, artifact: ArtifactInput) {
    return this.withLock(async () => {
      if (!Number.isInteger(round) || round < 0) throw new Error("round 必须是非负整数");
      const target = validateRelativePath(artifact.target);
      const manifest = await this.requireManifest();
      const id = randomUUID();
      const contentFile = `${sessionRoot(this.sessionId)}/round-${round}/${id}.artifact`;
      await assertSafeStorePath(this.io, contentFile);
      await this.io.writeFile(contentFile, artifact.content);
      const digest = digestOf(artifact.content);
      const staged = StagedArtifactSchema.parse({ id, round, target, contentFile, digest, status: "staged" });
      manifest.artifacts.push(staged);
      await this.persist(manifest);
      return structuredClone(staged);
    });
  }

  commit(candidateIds: string[]) {
    return this.withLock(async () => {
      const manifest = await this.requireManifest();
      await this.recover(manifest);
      const selected = candidateIds.map((id) => {
        const artifact = manifest.artifacts.find((entry) => entry.id === id);
        if (!artifact) throw new Error(`未知候选 ID: ${id}`);
        return artifact;
      });
      const targets = new Set<string>();
      for (const artifact of selected) {
        if (targets.has(artifact.target)) throw new Error(`同一 target 只能选择一个工件: ${artifact.target}`);
        targets.add(artifact.target);
      }
      for (const artifact of selected) {
        if (artifact.status === "committed") continue;
        await this.commitArtifact(manifest, artifact);
      }
    });
  }

  status(id: string) {
    return this.withLock(async () => {
      const manifest = await this.requireManifest();
      await this.recover(manifest);
      return manifest.artifacts.find((artifact) => artifact.id === id)?.status ?? null;
    });
  }

  saveState(state: unknown) {
    return this.withLock(async () => {
      await assertSafeStorePath(this.io, statePath(this.sessionId));
      await this.io.writeJSON(statePath(this.sessionId), state);
    });
  }

  async loadState<T = unknown>(): Promise<T | null> {
    await assertSafeStorePath(this.io, statePath(this.sessionId));
    return this.io.readJSON<T>(statePath(this.sessionId));
  }

  private async commitArtifact(manifest: Manifest, artifact: StagedArtifact) {
    artifact.status = "committing";
    await this.persist(manifest);
    await assertSafeStorePath(this.io, artifact.contentFile);
    await assertSafeStorePath(this.io, artifact.target);
    const content = await this.io.readFile(artifact.contentFile);
    if (digestOf(content) !== artifact.digest) throw new Error(`暂存内容摘要不匹配: ${artifact.id}`);
    await this.io.writeFile(artifact.target, content);
    artifact.status = "committed";
    await this.persist(manifest);
  }

  private async recover(manifest: Manifest) {
    for (const artifact of manifest.artifacts) {
      if (artifact.status !== "committing") continue;
      await assertSafeStorePath(this.io, artifact.contentFile);
      await assertSafeStorePath(this.io, artifact.target);
      const content = await this.io.readFile(artifact.contentFile);
      if (digestOf(content) !== artifact.digest) throw new Error(`暂存内容摘要不匹配: ${artifact.id}`);
      const targetDigest = await readDigest(this.io, artifact.target);
      if (targetDigest !== artifact.digest) await this.io.writeFile(artifact.target, content);
      artifact.status = "committed";
      await this.persist(manifest);
    }
  }

  private async readManifest() {
    await assertSafeStorePath(this.io, manifestPath(this.sessionId));
    const stored = await this.io.readJSON<unknown>(manifestPath(this.sessionId));
    if (!stored) return null;
    const manifest = ManifestSchema.parse(stored);
    if (manifest.sessionId !== this.sessionId) throw new Error("暂存 manifest session 无效");
    manifest.artifacts.forEach((artifact) => validateArtifact(artifact, this.sessionId));
    return manifest;
  }

  private async requireManifest() {
    const manifest = await this.readManifest();
    if (!manifest) throw new Error("暂存 manifest 不存在");
    return manifest;
  }

  private async persist(manifest: Manifest) {
    ManifestSchema.parse(manifest);
    await assertSafeStorePath(this.io, manifestPath(this.sessionId));
    await this.io.writeJSON(manifestPath(this.sessionId), manifest);
  }

  private withLock<T>(operation: () => Promise<T>) {
    const key = `${resolve(this.io.dir)}\0${this.sessionId}`;
    const previous = StagingSession.locks.get(key) ?? Promise.resolve();
    const result = previous.then(operation);
    const settled = result.then(() => undefined, () => undefined);
    StagingSession.locks.set(key, settled);
    settled.finally(() => { if (StagingSession.locks.get(key) === settled) StagingSession.locks.delete(key); });
    return result;
  }
}

function validateArtifact(artifact: StagedArtifact, sessionId: string) {
  validateRelativePath(artifact.target);
  const expected = `${sessionRoot(sessionId)}/round-${artifact.round}/${artifact.id}.artifact`;
  if (artifact.contentFile !== expected) throw new Error("暂存内容路径越界");
}

function validateSegment(value: string, label: string) {
  if (!value || value === "." || value === ".." || value.includes("/") || value.includes("\\")) throw new Error(`${label} 标识无效`);
}

function validateRelativePath(value: string) {
  if (!value || isAbsolute(value)) throw new Error("路径必须是 store 内的相对路径");
  const normalized = posix.normalize(value.replaceAll("\\", "/"));
  if (normalized === ".." || normalized.startsWith("../")) throw new Error("路径越界");
  return normalized;
}

async function assertSafeStorePath(io: FileIO, rel: string) {
  const normalized = validateRelativePath(rel);
  const root = await realpath(io.dir);
  const target = resolve(root, normalized);
  const fromRoot = relative(root, target);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) throw new Error("路径越界");
  let current = root;
  for (const part of normalized.split("/")) {
    current = resolve(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error(`路径包含符号链接: ${rel}`);
    } catch (error) {
      if (isMissing(error)) break;
      throw error;
    }
  }
}

async function readDigest(io: FileIO, rel: string) {
  try { return digestOf(await io.readFile(rel)); }
  catch (error) { if (isMissing(error)) return null; throw error; }
}

function digestOf(content: string | Uint8Array) {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function sessionRoot(sessionId: string) { return `meta/reflection/${sessionId}`; }
function manifestPath(sessionId: string) { return `${sessionRoot(sessionId)}/manifest.json`; }
function statePath(sessionId: string) { return `${sessionRoot(sessionId)}/state.json`; }
