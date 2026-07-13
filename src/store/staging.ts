import { randomUUID } from "node:crypto";
import { isAbsolute, normalize, posix, relative, resolve } from "node:path";
import { FileIO } from "./io.js";

export interface StagedArtifact {
  id: string;
  round: number;
  target: string;
  contentFile: string;
  status: "staged" | "committed";
}

interface Manifest {
  sessionId: string;
  artifacts: StagedArtifact[];
}

export interface ArtifactInput {
  target: string;
  content: string | Uint8Array;
}

export class StagedArtifactStore {
  constructor(private readonly io: FileIO) {}

  async createSession(sessionId: string = randomUUID()) {
    validateSegment(sessionId, "session");
    const session = new StagingSession(this.io, sessionId);
    await session.initialize();
    return session;
  }

  async saveState(sessionId: string, state: unknown) {
    validateSegment(sessionId, "session");
    await this.io.writeJSON(statePath(sessionId), state);
  }

  async loadState<T = unknown>(sessionId: string): Promise<T | null> {
    validateSegment(sessionId, "session");
    return this.io.readJSON<T>(statePath(sessionId));
  }
}

export class StagingSession {
  private manifest: Manifest;
  private chain = Promise.resolve();

  constructor(private readonly io: FileIO, readonly sessionId: string) {
    this.manifest = { sessionId, artifacts: [] };
  }

  async initialize() {
    const stored = await this.io.readJSON<Manifest>(manifestPath(this.sessionId));
    if (stored) {
      if (stored.sessionId !== this.sessionId || !Array.isArray(stored.artifacts)) throw new Error("暂存 manifest 无效");
      stored.artifacts.forEach((artifact) => validateArtifact(artifact, this.sessionId));
      this.manifest = stored;
      return;
    }
    await this.persist();
  }

  stage(round: number, artifact: ArtifactInput) {
    return this.exclusive(async () => {
      if (!Number.isInteger(round) || round < 0) throw new Error("round 必须是非负整数");
      const target = validateRelativePath(artifact.target);
      const id = randomUUID();
      const contentFile = `${sessionRoot(this.sessionId)}/round-${round}/${id}.artifact`;
      await this.io.writeFile(contentFile, artifact.content);
      const staged: StagedArtifact = { id, round, target, contentFile, status: "staged" };
      this.manifest.artifacts.push(staged);
      await this.persist();
      return structuredClone(staged);
    });
  }

  commit(candidateIds: string[]) {
    return this.exclusive(async () => {
      const selected = new Set(candidateIds);
      for (const artifact of this.manifest.artifacts) {
        if (!selected.has(artifact.id) || artifact.status === "committed") continue;
        validateArtifact(artifact, this.sessionId);
        await this.io.writeFile(artifact.target, await this.io.readFile(artifact.contentFile));
        artifact.status = "committed";
        await this.persist();
      }
    });
  }

  async status(id: string) {
    await this.chain;
    return this.manifest.artifacts.find((artifact) => artifact.id === id)?.status ?? null;
  }

  saveState(state: unknown) { return this.exclusive(() => this.io.writeJSON(statePath(this.sessionId), state)); }

  loadState<T = unknown>(): Promise<T | null> { return this.io.readJSON<T>(statePath(this.sessionId)); }

  private persist() { return this.io.writeJSON(manifestPath(this.sessionId), this.manifest); }

  private exclusive<T>(operation: () => Promise<T>) {
    const result = this.chain.then(operation);
    this.chain = result.then(() => undefined, () => undefined);
    return result;
  }
}

function validateArtifact(artifact: StagedArtifact, sessionId: string) {
  validateRelativePath(artifact.target);
  const contentFile = validateRelativePath(artifact.contentFile);
  const expectedRoot = `${sessionRoot(sessionId)}/`;
  if (!contentFile.startsWith(expectedRoot)) throw new Error("暂存内容路径越界");
  if (artifact.status !== "staged" && artifact.status !== "committed") throw new Error("暂存状态无效");
}

function validateSegment(value: string, label: string) {
  if (!value || value === "." || value === ".." || value.includes("/") || value.includes("\\")) throw new Error(`${label} 标识无效`);
}

function validateRelativePath(value: string) {
  if (!value || isAbsolute(value)) throw new Error("路径必须是 store 内的相对路径");
  const normalized = posix.normalize(value.replaceAll("\\", "/"));
  if (normalized === ".." || normalized.startsWith("../")) throw new Error("路径越界");
  const root = resolve("/");
  if (relative(root, resolve(root, normalized)).startsWith("..")) throw new Error("路径越界");
  return normalize(normalized).replaceAll("\\", "/");
}

function sessionRoot(sessionId: string) { return `meta/reflection/${sessionId}`; }
function manifestPath(sessionId: string) { return `${sessionRoot(sessionId)}/manifest.json`; }
function statePath(sessionId: string) { return `${sessionRoot(sessionId)}/state.json`; }
