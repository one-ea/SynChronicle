import { CheckpointSchema, type Checkpoint, type Scope } from "../domain/index.js";
import { createHash } from "node:crypto";
import { FileIO, parseJSONLines } from "./io.js";

const file = "meta/checkpoints.jsonl";
export class CheckpointStore {
  private cache: Checkpoint[] = [];
  private ready: Promise<void>;
  private chain = Promise.resolve();
  constructor(private readonly io: FileIO) { this.ready = this.restore(); }
  private async restore() { this.cache = parseJSONLines(await this.io.readText(file), CheckpointSchema, true); }
  private exclusive<T>(fn: () => Promise<T>) { const result = this.chain.then(fn); this.chain = result.then(() => undefined, () => undefined); return result; }
  append(scope: Scope, step: string, artifact = "", digest = "") { return this.exclusive(async () => { await this.ready; if (digest) { const found = [...this.cache].reverse().find((cp) => matches(cp.scope, scope) && cp.step === step && cp.digest === digest); if (found) return structuredClone(found); } const checkpoint = CheckpointSchema.parse({ seq: (this.cache.at(-1)?.seq ?? 0) + 1, scope, step, ...(artifact && { artifact }), ...(digest && { digest }), occurred_at: new Date().toISOString() }); await this.io.appendJSONLine(file, checkpoint); this.cache.push(checkpoint); return structuredClone(checkpoint); }); }
  async appendArtifact(scope: Scope, step: string, artifact: string) { if (!artifact) return this.append(scope, step); const digest = createHash("sha256").update(await this.io.readFile(artifact)).digest("hex"); return this.append(scope, step, artifact, `sha256:${digest}`); }
  async latest(scope: Scope) { await this.ready; return structuredClone([...this.cache].reverse().find((cp) => matches(cp.scope, scope)) ?? null); }
  async latestByStep(scope: Scope, step: string) { await this.ready; return structuredClone([...this.cache].reverse().find((cp) => matches(cp.scope, scope) && cp.step === step) ?? null); }
  async latestGlobal() { await this.ready; return structuredClone(this.cache.at(-1) ?? null); }
  async all() { await this.ready; return structuredClone(this.cache); }
  async reset() { await this.ready; await this.io.remove(file); this.cache = []; }
  async listSince(seq: number) { return (await this.all()).filter((cp) => cp.seq >= seq); }
  async clearFrom(seq: number) { await this.ready; const kept = this.cache.filter((cp) => cp.seq < seq); await this.io.writeFile(file, kept.map((cp) => JSON.stringify(cp)).join("\n") + (kept.length ? "\n" : "")); this.cache = kept; }
}
function matches(a: Scope, b: Scope) { return a.kind === b.kind && (b.chapter === undefined || a.chapter === b.chapter) && (b.volume === undefined || a.volume === b.volume) && (b.arc === undefined || a.arc === b.arc); }
