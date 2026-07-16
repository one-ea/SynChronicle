import { describe, expect, it, vi } from "vitest";
import { decryptCredential, encryptCredential, type CredentialEnvelope, type MasterKeyRegistry } from "./envelope.js";
import { rotateCredentialBatch, walkCredentialPages, type RotatableCredential } from "./rotation.js";

const oldKey = Buffer.alloc(32, "o");
const newKey = Buffer.alloc(32, "n");
const registry: MasterKeyRegistry = { currentVersion: "v2", keys: new Map([["v1", oldKey], ["v2", newKey]]) };

function credential(id: string, status: RotatableCredential["status"] = "active"): RotatableCredential {
  const aad = { userId: "user-1", credentialId: id, provider: "openai" };
  return { id, ...aad, status, envelope: encryptCredential({ currentVersion: "v1", keys: registry.keys }, `secret-${id}`, aad) };
}

describe("credential key rotation", () => {
  it("re-encrypts active and disabled credentials with the current key without exposing plaintext", async () => {
    const rows = [credential("a"), credential("b", "disabled"), credential("c", "revoked")];
    const save = vi.fn(async (_row: RotatableCredential, _envelope: CredentialEnvelope) => undefined);
    const audit = vi.fn(async (_row: RotatableCredential, _previousVersion: string) => undefined);

    const result = await rotateCredentialBatch({ rows, registry, dryRun: false, save, audit });

    expect(result).toEqual({ examined: 3, rotated: 2, skipped: 1 });
    expect(save).toHaveBeenCalledTimes(2);
    for (const [, envelope] of save.mock.calls) {
      expect(envelope.keyVersion).toBe("v2");
      expect(JSON.stringify(envelope)).not.toContain("secret-");
    }
    const saved = save.mock.calls[0]![1];
    expect(decryptCredential(registry, saved, { userId: "user-1", credentialId: "a", provider: "openai" })).toBe("secret-a");
    expect(audit).toHaveBeenCalledTimes(2);
  });

  it("is idempotent and dry-run performs no writes", async () => {
    const current = credential("current");
    current.envelope = encryptCredential(registry, "secret-current", { userId: current.userId, credentialId: current.id, provider: current.provider });
    const save = vi.fn(async (_row: RotatableCredential, _envelope: CredentialEnvelope) => undefined);
    const audit = vi.fn(async (_row: RotatableCredential, _previousVersion: string) => undefined);

    const result = await rotateCredentialBatch({ rows: [credential("old"), current], registry, dryRun: true, save, audit });

    expect(result).toEqual({ examined: 2, rotated: 1, skipped: 1 });
    expect(save).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });
});

describe("walkCredentialPages", () => {
  it("advances a stable cursor so dry-runs remain bounded and recoverable", async () => {
    const rows = [credential("a"), credential("b"), credential("c")];
    const seen: string[] = [];
    const result = await walkCredentialPages({
      batchSize: 2,
      fetchPage: async (cursor, limit) => rows.filter((row) => !cursor || row.id > cursor).slice(0, limit),
      processPage: async (page) => { seen.push(...page.map((row) => row.id)); return { examined: page.length, rotated: page.length, skipped: 0 }; },
    });

    expect(seen).toEqual(["a", "b", "c"]);
    expect(result).toEqual({ examined: 3, rotated: 3, skipped: 0 });
  });
});
