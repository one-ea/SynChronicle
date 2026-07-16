import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  ArchiveValidationError,
  assertArtifactSafe,
  assertProjectArchiveSize,
  createProjectArchive,
  parseProjectArchive,
  streamProjectArchive,
  type ProjectArchiveManifest,
} from "./archive.js";
import { archiveFileProject, BackpressureChannel } from "./fileProjectImporter.js";

function manifest(overrides: Partial<ProjectArchiveManifest> = {}): ProjectArchiveManifest {
  const chapter = Buffer.from("Chapter one");
  return {
    format: "synchronicle-project",
    version: 1,
    project: { title: "Safe title", version: 3 },
    run: { id: "11111111-1111-4111-8111-111111111111", status: "completed", completedAt: "2026-07-16T00:00:00.000Z" },
    checkpoint: { id: "22222222-2222-4222-8222-222222222222", version: 2, projectVersion: 3, taskFingerprint: "stable" },
    exportedAt: "2026-07-16T00:00:00.000Z",
    chapters: [{ sequence: 1, title: "One", status: "complete", version: 2, path: "chapters/1.md", checksum: createHash("sha256").update(chapter).digest("hex") }],
    artifacts: [],
    planning: [],
    reviews: [],
    ...overrides,
  };
}

describe("project migration archive", () => {
  it("round-trips a versioned manifest and chapter body", async () => {
    const archive = createProjectArchive(manifest(), new Map([["chapters/1.md", Buffer.from("Chapter one")]]));
    const parsed = await parseProjectArchive(archive);
    expect(parsed.manifest).toMatchObject({ format: "synchronicle-project", version: 1, project: { title: "Safe title", version: 3 } });
    expect(parsed.files.get("chapters/1.md")?.toString()).toBe("Chapter one");
  });

  it.each(["../secret", "/absolute", "chapters/../../secret", "C:\\secret"])("rejects unsafe archive path %s", async (path) => {
    const unsafe = manifest({ chapters: [{ ...manifest().chapters[0]!, path }] });
    expect(() => createProjectArchive(unsafe, new Map([[path, Buffer.from("Chapter one")]]))).toThrow(ArchiveValidationError);
  });

  it("rejects checksum mismatches and secret-shaped fields", async () => {
    const archive = createProjectArchive(manifest(), new Map([["chapters/1.md", Buffer.from("Chapter one")]]));
    const bodyOffset = archive.indexOf(Buffer.from("Chapter one"));
    archive[bodyOffset] = archive[bodyOffset]! ^ 1;
    await expect(parseProjectArchive(archive)).rejects.toThrow(/checksum/i);

    const secret = { ...manifest(), project: { ...manifest().project, credential: "forbidden" } } as unknown as ProjectArchiveManifest;
    expect(() => createProjectArchive(secret, new Map([["chapters/1.md", Buffer.from("Chapter one")]]))).toThrow(/secret|credential/i);
  });

  it("stops reading streams above the configured archive limit", async () => {
    async function* chunks() { yield Buffer.alloc(6); yield Buffer.alloc(6); }
    await expect(parseProjectArchive(chunks(), { maxBytes: 10 })).rejects.toThrow(/size/i);
  });

  it("reads deflate entries with data descriptors and validates the central directory", async () => {
    const archive = createProjectArchive(manifest(), new Map([["chapters/1.md", Buffer.from("Chapter one")]]), { compression: "deflate", dataDescriptor: true });
    await expect(parseProjectArchive(archive)).resolves.toMatchObject({ manifest: { version: 1 } });
    const central = archive.indexOf(Buffer.from("PK\x01\x02", "binary"));
    archive.writeUInt32LE(99, central + 24);
    await expect(parseProjectArchive(archive)).rejects.toThrow(/central|size/i);
  });

  it("rejects encrypted, symlink, ZIP64, duplicate normalized paths, excessive entries and compression bombs", async () => {
    const base = createProjectArchive(manifest(), new Map([["chapters/1.md", Buffer.from("Chapter one")]]));
    const encrypted = Buffer.from(base); encrypted.writeUInt16LE(encrypted.readUInt16LE(6) | 1, 6);
    await expect(parseProjectArchive(encrypted)).rejects.toThrow(/encrypted/i);
    const zip64 = Buffer.from(base); zip64.writeUInt32LE(0xffffffff, 18);
    await expect(parseProjectArchive(zip64)).rejects.toThrow(/ZIP64/i);
    const symlink = Buffer.from(base); const symlinkCentral = symlink.indexOf(Buffer.from("PK\x01\x02", "binary")); symlink.writeUInt32LE((0o120777 << 16) >>> 0, symlinkCentral + 38);
    await expect(parseProjectArchive(symlink)).rejects.toThrow(/symlink/i);
    const multiDisk = Buffer.from(base); const end = multiDisk.lastIndexOf(Buffer.from("PK\x05\x06", "binary")); multiDisk.writeUInt16LE(1, end + 4);
    await expect(parseProjectArchive(multiDisk)).rejects.toThrow(/multi-disk/i);
    await expect(parseProjectArchive(base, { maxEntries: 1 })).rejects.toThrow(/entry count/i);
    const bombBody = Buffer.alloc(100_000, 65);
    const bombManifest = manifest({ chapters: [{ ...manifest().chapters[0]!, checksum: createHash("sha256").update(bombBody).digest("hex") }] });
    const bomb = createProjectArchive(bombManifest, new Map([["chapters/1.md", bombBody]]), { compression: "deflate" });
    await expect(parseProjectArchive(bomb, { maxCompressionRatio: 10 })).rejects.toThrow(/compression ratio/i);

    const one = Buffer.from("one"), two = Buffer.from("two");
    const withArtifact = manifest({
      chapters: [{ ...manifest().chapters[0]!, path: "files/a.txt", checksum: createHash("sha256").update(one).digest("hex") }],
      artifacts: [{ type: "notes", status: "committed", version: 1, encoding: "text", path: "files/b.txt", checksum: createHash("sha256").update(two).digest("hex") }],
    });
    const duplicate = createProjectArchive(withArtifact, new Map([["files/a.txt", one], ["files/b.txt", two]]));
    const names: number[] = [];
    for (let offset = 0; offset < duplicate.length; offset++) if (duplicate.subarray(offset, offset + 11).toString() === "files/b.txt") names.push(offset);
    for (const offset of names.slice(-2)) duplicate[offset + 6] = "a".charCodeAt(0);
    await expect(parseProjectArchive(duplicate)).rejects.toThrow(/duplicate normalized/i);
  });

  it("requires unique chapter, artifact, planning, review and normalized paths", () => {
    const chapter = manifest().chapters[0]!;
    const duplicate = manifest({ chapters: [chapter, { ...chapter, path: "chapters/./1.md" }] });
    expect(() => createProjectArchive(duplicate, new Map([["chapters/1.md", Buffer.from("Chapter one")]]))).toThrow(/unique|duplicate/i);
    const dangling = manifest({ planning: [{ type: "outline", path: "artifacts/missing.json", version: 1 }] });
    expect(() => createProjectArchive(dangling, new Map([["chapters/1.md", Buffer.from("Chapter one")]]))).toThrow(/planning|reference/i);
  });

  it("scans JSON recursively and text assignments while allowing prose mentions", () => {
    expect(() => assertArtifactSafe("json", JSON.stringify({ nested: { apiKey: "value" } }))).toThrow(/sensitive/i);
    expect(() => assertArtifactSafe("text", "Authorization: Bearer abcdefghijklmnopqrstuvwxyz")).toThrow(/sensitive/i);
    expect(() => assertArtifactSafe("text", "The detective searched for the stolen password in chapter twelve.")).not.toThrow();
  });

  it("streams ZIP output without constructing one complete archive and enforces output limits", async () => {
    async function* entries() { yield { path: "chapters/1.md", content: Buffer.from("Chapter one") }; }
    const chunks: Uint8Array[] = [];
    for await (const chunk of streamProjectArchive(manifest(), entries(), { maxBytes: 1_000_000, maxEntryBytes: 10_000 })) chunks.push(chunk);
    expect(chunks.length).toBeGreaterThan(3);
    await expect(async () => { for await (const _ of streamProjectArchive(manifest(), entries(), { maxBytes: 20, maxEntryBytes: 10_000 })) void _; }).rejects.toThrow(/archive size/i);
    try { for await (const _ of streamProjectArchive(manifest(), entries(), { maxBytes: 20, maxEntryBytes: 10_000 })) void _; } catch (error) { expect(error).toMatchObject({ statusCode: 413 }); }
    try { for await (const _ of streamProjectArchive(manifest(), entries(), { maxBytes: 1_000_000, maxEntryBytes: 5 })) void _; } catch (error) { expect(error).toMatchObject({ statusCode: 422 }); }
  });

  it("preflights exact stored ZIP size before the first response chunk", () => {
    expect(() => assertProjectArchiveSize(manifest(), [{ path: "chapters/1.md", size: 11 }], { maxBytes: 20, maxEntryBytes: 100_000 })).toThrow(expect.objectContaining({ statusCode: 413 }));
    expect(() => assertProjectArchiveSize(manifest(), [{ path: "chapters/1.md", size: 11 }], { maxBytes: 100_000, maxEntryBytes: 10 })).toThrow(expect.objectContaining({ statusCode: 422 }));
  });
});

describe("atomic imports", () => {
  it("leaves transaction state untouched when an insert fails", async () => {
    const state = { projects: 0, chapters: 0 };
    const transaction = vi.fn(async (operation: (tx: typeof state) => Promise<void>) => {
      const pending = { ...state };
      await operation(pending);
      Object.assign(state, pending);
    });
    await expect(transaction(async (tx) => {
      tx.projects += 1;
      throw new Error("chapter insert failed");
    })).rejects.toThrow("chapter insert failed");
    expect(state).toEqual({ projects: 0, chapters: 0 });
  });
});

describe("export backpressure", () => {
  it("propagates a producer failure to a waiting consumer without replacing it", async () => {
    const channel = new BackpressureChannel();
    const original = new Error("snapshot failed");
    const waiting = channel[Symbol.asyncIterator]().next();
    channel.fail(original);
    await expect(waiting).rejects.toBe(original);
  });
});

describe("file project migration", () => {
  it("converts progress metadata and completed chapters without credentials", async () => {
    const root = await mkdtemp(join(tmpdir(), "synchronicle-migration-"));
    await mkdir(join(root, "meta"));
    await mkdir(join(root, "chapters"));
    await writeFile(join(root, "meta", "progress.json"), JSON.stringify({ novel_name: "Legacy", completed_chapters: [1], credential: "must-not-export" }));
    await writeFile(join(root, "chapters", "01.md"), "# Opening\n\nBody");

    const archive = await archiveFileProject(root);
    const parsed = await parseProjectArchive(archive);
    expect(parsed.manifest.project.title).toBe("Legacy");
    expect(parsed.files.get("chapters/1.md")?.toString()).toContain("Body");
    expect(JSON.stringify(parsed.manifest)).not.toMatch(/credential|must-not-export/);
  });
});
