import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../store/index.js";
import { FORESHADOW_ABSENCE, foreshadowFindings } from "./foreshadow.js";

async function seededStore(threads: string[], chapters: Array<{ n: number; text: string }>): Promise<Store> {
  const dir = await mkdtemp(join(tmpdir(), "synchronicle-foreshadow-"));
  for (const sub of ["meta", "chapters"]) await mkdir(join(dir, sub), { recursive: true });
  const store = new Store(dir);
  const completed = chapters.map((chapter) => chapter.n);
  await writeFile(join(dir, "meta", "progress.json"), JSON.stringify({ novel_name: "t", phase: "writing", current_chapter: completed.length + 1, total_chapters: 99, completed_chapters: completed, total_word_count: 0, flow: "writing", pending_rewrites: [] }));
  for (const chapter of chapters) await writeFile(join(dir, "chapters", `${String(chapter.n).padStart(2, "0")}.md`), chapter.text);
  if (threads.length) await writeFile(join(dir, "meta", "compass.json"), JSON.stringify({ ending_direction: "end", open_threads: threads }));
  return store;
}

describe("foreshadowFindings", () => {
  it("flags a thread gone stale beyond the threshold", async () => {
    const chapters = Array.from({ length: FORESHADOW_ABSENCE + 3 }, (_unused, index) => ({ n: index + 1, text: index === 0 ? "神秘玉佩的来历藏在钟楼。" : "日常推进。" }));
    const store = await seededStore(["神秘玉佩的来历"], chapters);
    try {
      const findings = await foreshadowFindings(store);
      const rule = findings.find((finding) => finding.rule === "ForeshadowStall.stale");
      expect(rule?.severity).toBe("warning");
      expect(rule?.evidence).toContain("神秘玉佩");
    } finally { await rm(store.dir, { recursive: true, force: true }); }
  });

  it("flags a thread never mentioned after enough chapters", async () => {
    const store = await seededStore(["没人提过的线索"], Array.from({ length: FORESHADOW_ABSENCE + 2 }, (_unused, index) => ({ n: index + 1, text: "普通正文。" })));
    try {
      const findings = await foreshadowFindings(store);
      expect(findings.some((finding) => finding.rule === "ForeshadowStall.absent")).toBe(true);
    } finally { await rm(store.dir, { recursive: true, force: true }); }
  });

  it("keeps silence for freshly mentioned threads and missing compass", async () => {
    const chapters = Array.from({ length: 12 }, (_unused, index) => ({ n: index + 1, text: index === 11 ? "再次呼应：神秘玉佩的来历。" : "日常推进。" }));
    const store = await seededStore(["神秘玉佩的来历"], chapters);
    const empty = await seededStore([], [{ n: 1, text: "x" }]);
    try {
      expect(await foreshadowFindings(store)).toEqual([]);
      expect(await foreshadowFindings(empty)).toEqual([]);
    } finally { await rm(store.dir, { recursive: true, force: true }); await rm(empty.dir, { recursive: true, force: true }); }
  });
});
