import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Store } from "./index.js";
import { FileIO } from "./io.js";
import { StagedArtifactStore } from "./staging.js";

const tempStore = async () => {
  const dir = await mkdtemp(join(tmpdir(), "synchronicle-staging-"));
  const store = new Store(dir);
  await store.init();
  return { dir, store };
};

describe("StagedArtifactStore", () => {
  it("commits only selected artifacts and resumes idempotently", async () => {
    const { store } = await tempStore();
    const staging = await store.staging.createSession("session-1");
    const first = await staging.stage(1, { target: "chapters/01.md", content: "low" });
    const second = await staging.stage(2, { target: "chapters/01.md", content: "best" });

    await staging.commit([second.id]);
    await staging.commit([second.id]);

    expect(await store.drafts.loadChapterText(1)).toContain("best");
    expect(await staging.status(first.id)).toBe("staged");
    expect(await staging.status(second.id)).toBe("committed");
  });

  it("isolates sessions and persists resumable state", async () => {
    const { store } = await tempStore();
    const first = await store.staging.createSession("session-1");
    const artifact = await first.stage(1, { target: "chapters/01.md", content: "one" });
    await first.saveState({ round: 1, candidateIds: [artifact.id] });

    const second = await store.staging.createSession("session-2");
    expect(await second.status(artifact.id)).toBeNull();
    expect(await store.staging.loadState("session-1")).toEqual({ round: 1, candidateIds: [artifact.id] });
  });

  it("records each successful commit before a later artifact fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "synchronicle-staging-failure-"));
    let writes = 0;
    class FailingIO extends FileIO {
      override async writeFile(target: string, data: string | Uint8Array) {
        if (target.startsWith("chapters/")) {
          writes += 1;
          if (writes === 2) throw new Error("disk full");
        }
        await super.writeFile(target, data);
      }
    }
    const io = new FailingIO(dir);
    const store = new StagedArtifactStore(io);
    const session = await store.createSession("session-1");
    const first = await session.stage(1, { target: "chapters/01.md", content: "one" });
    const second = await session.stage(1, { target: "chapters/02.md", content: "two" });

    await expect(session.commit([first.id, second.id])).rejects.toThrow("disk full");
    expect(await session.status(first.id)).toBe("committed");
    expect(await session.status(second.id)).toBe("committed");

    const resumed = await new StagedArtifactStore(new FileIO(dir)).createSession("session-1");
    await resumed.commit([first.id, second.id]);
    expect(await readFile(join(dir, "chapters", "02.md"), "utf8")).toBe("two");
  });

  it("rejects paths that escape the store", async () => {
    const { store } = await tempStore();
    await expect(store.staging.createSession("../outside")).rejects.toThrow("session");
    const staging = await store.staging.createSession("session-1");
    await expect(staging.stage(1, { target: "../outside.md", content: "bad" })).rejects.toThrow("路径");
    await expect(staging.stage(1, { target: "/tmp/outside.md", content: "bad" })).rejects.toThrow("路径");
  });

  it("rejects a manifest that references another session's content", async () => {
    const { dir, store } = await tempStore();
    await store.staging.createSession("session-1");
    const manifest = {
      sessionId: "session-1",
      artifacts: [{
        id: "candidate-1",
        round: 1,
        target: "chapters/01.md",
        contentFile: "meta/reflection/session-2/round-1/candidate-1.artifact",
        digest: `sha256:${createHash("sha256").update("content").digest("hex")}`,
        status: "staged",
      }],
    };
    await writeFile(join(dir, "meta", "reflection", "session-1", "manifest.json"), JSON.stringify(manifest));

    await expect(new StagedArtifactStore(new FileIO(dir)).createSession("session-1")).rejects.toThrow("暂存内容路径越界");
  });

  it("rejects duplicate targets and unknown candidate ids before writing", async () => {
    const { dir, store } = await tempStore();
    const session = await store.staging.createSession("session-1");
    const first = await session.stage(1, { target: "chapters/01.md", content: "one" });
    const second = await session.stage(2, { target: "chapters/01.md", content: "two" });

    await expect(session.commit([first.id, second.id])).rejects.toThrow("target");
    await expect(session.commit([first.id, "missing"])).rejects.toThrow("未知候选");
    await expect(readFile(join(dir, "chapters", "01.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(await session.status(first.id)).toBe("staged");
    expect(await session.status(second.id)).toBe("staged");
  });

  it("recovers a target write when the committed manifest update failed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "synchronicle-staging-manifest-failure-"));
    let failCommittedManifest = true;
    class FailingManifestIO extends FileIO {
      override async writeFile(target: string, data: string | Uint8Array) {
        const text = typeof data === "string" ? data : Buffer.from(data).toString("utf8");
        if (target.endsWith("/manifest.json") && text.includes('"status": "committed"') && failCommittedManifest) {
          failCommittedManifest = false;
          throw new Error("manifest unavailable");
        }
        await super.writeFile(target, data);
      }
    }
    const session = await new StagedArtifactStore(new FailingManifestIO(dir)).createSession("session-1");
    const artifact = await session.stage(1, { target: "chapters/01.md", content: "final" });

    await expect(session.commit([artifact.id])).rejects.toThrow("manifest unavailable");
    expect(await readFile(join(dir, "chapters", "01.md"), "utf8")).toBe("final");

    const resumed = await new StagedArtifactStore(new FileIO(dir)).createSession("session-1");
    expect(await resumed.status(artifact.id)).toBe("committed");
    await resumed.commit([artifact.id]);
    expect(await readFile(join(dir, "chapters", "01.md"), "utf8")).toBe("final");
  });

  it("serializes multiple instances for the same session without losing artifacts", async () => {
    const { dir } = await tempStore();
    const first = await new StagedArtifactStore(new FileIO(dir)).createSession("session-1");
    const second = await new StagedArtifactStore(new FileIO(dir)).createSession("session-1");

    const [one, two] = await Promise.all([
      first.stage(1, { target: "chapters/01.md", content: "one" }),
      second.stage(1, { target: "chapters/02.md", content: "two" }),
    ]);

    const resumed = await new StagedArtifactStore(new FileIO(dir)).createSession("session-1");
    expect(await resumed.status(one.id)).toBe("staged");
    expect(await resumed.status(two.id)).toBe("staged");
  });

  it("validates the complete manifest schema", async () => {
    const { dir, store } = await tempStore();
    await store.staging.createSession("session-1");
    const invalid = {
      sessionId: "session-1",
      artifacts: [
        { id: "duplicate", round: 0, target: "chapters/01.md", contentFile: "meta/reflection/session-1/round-0/duplicate.artifact", digest: "bad", status: "staged" },
        { id: "duplicate", round: -1, target: "chapters/02.md", contentFile: "wrong", digest: "bad", status: "unknown" },
      ],
    };
    await writeFile(join(dir, "meta", "reflection", "session-1", "manifest.json"), JSON.stringify(invalid));

    await expect(new StagedArtifactStore(new FileIO(dir)).createSession("session-1")).rejects.toThrow();
  });

  it("rejects a target whose parent escapes through a symbolic link", async () => {
    const { dir, store } = await tempStore();
    const outside = await mkdtemp(join(tmpdir(), "synchronicle-outside-"));
    await mkdir(join(dir, "links"), { recursive: true });
    await symlink(outside, join(dir, "links", "escape"));
    const session = await store.staging.createSession("session-1");
    const artifact = await session.stage(1, { target: "links/escape/outside.md", content: "bad" });

    await expect(session.commit([artifact.id])).rejects.toThrow("符号链接");
    await expect(readFile(join(outside, "outside.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });
});
