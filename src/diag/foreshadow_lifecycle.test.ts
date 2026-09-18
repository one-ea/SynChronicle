import { describe, expect, it } from "vitest";
import { ForeshadowLifecycleStageSchema, ForeshadowTrackSchema } from "../domain/foreshadow.js";
import { foreshadowFindings } from "./foreshadow.js";
import { Store } from "../store/index.js";
import { FileIO } from "../store/io.js";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Foreshadow Lifecycle and Diagnostics", () => {
  it("validates four lifecycle stages in sequence", () => {
    expect(ForeshadowLifecycleStageSchema.parse("planted")).toBe("planted");
    expect(ForeshadowLifecycleStageSchema.parse("hinted")).toBe("hinted");
    expect(ForeshadowLifecycleStageSchema.parse("misled")).toBe("misled");
    expect(ForeshadowLifecycleStageSchema.parse("resolved")).toBe("resolved");
    expect(() => ForeshadowLifecycleStageSchema.parse("broken")).toThrow();

    const track = ForeshadowTrackSchema.parse({
      id: "sword-secret",
      title: "断剑之谜",
      stage: "hinted",
      plantedChapter: 2,
    });
    expect(track.stage).toBe("hinted");
    expect(track.urgency).toBe("medium");
  });

  it("raises critical ForeshadowLeak warning when approaching novel finale", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sync-foreshadow-test-"));
    try {
      const io = new FileIO(dir);
      const store = new Store(dir, io);
      for (const sub of ["meta", "chapters"]) await mkdir(join(dir, sub), { recursive: true });

      await writeFile(join(dir, "meta", "compass.json"), JSON.stringify({
        ending_direction: "解开身世并拯救大陆",
        open_threads: ["生母遗留的血玉钥匙"],
      }));
      await writeFile(join(dir, "meta", "progress.json"), JSON.stringify({
        novel_name: "终卷测试",
        phase: "writing",
        current_chapter: 10,
        total_chapters: 10,
        completed_chapters: [1, 2, 3, 4, 5, 6, 7, 8, 9],
        total_word_count: 9000,
        flow: "writing",
      }));

      const findings = await foreshadowFindings(store);
      expect(findings.some((f) => f.rule === "ForeshadowLeak.unresolved" && f.severity === "critical")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
