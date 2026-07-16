import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  ArchiveValidationError,
  createProjectArchive,
  parseProjectArchive,
  type ProjectArchiveManifest,
} from "./archive.js";
import { archiveFileProject } from "./fileProjectImporter.js";

function manifest(overrides: Partial<ProjectArchiveManifest> = {}): ProjectArchiveManifest {
  const chapter = Buffer.from("Chapter one");
  return {
    format: "synchronicle-project",
    version: 1,
    project: { title: "Safe title", version: 3 },
    exportedAt: "2026-07-16T00:00:00.000Z",
    chapters: [{ sequence: 1, title: "One", status: "complete", version: 2, path: "chapters/1.md", checksum: createHash("sha256").update(chapter).digest("hex") }],
    artifacts: [],
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
