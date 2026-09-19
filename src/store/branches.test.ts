import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileIO } from "./io.js";
import { BranchStore } from "./branches.js";

describe("BranchStore", () => {
  it("creates an isolated story branch and merges to main", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sync-branch-test-"));
    try {
      const io = new FileIO(dir);
      const store = new BranchStore(io);
      await io.writeFile("chapters/03.md", "主干第3章：主角选择离开故乡。");

      // Fork 出平行分支
      const branch = await store.createBranch({
        id: "branch-stay",
        name: "留下坚守if线",
        chapter: 3,
        notes: "主角决定留下与魔族决战",
      });
      expect(branch.id).toBe("branch-stay");

      const initialBranchText = await store.getBranchContent("branch-stay", 3);
      expect(initialBranchText).toContain("选择离开故乡");

      // 分支独立编辑推进
      await store.saveBranchContent("branch-stay", 3, "分支第3章：主角拔剑决定留守村庄！");
      const mainText = await io.readText("chapters/03.md");
      expect(mainText).toContain("选择离开故乡"); // 主干不受破坏

      // 合并分支到主干
      const result = await store.mergeBranchToMain("branch-stay", 3);
      expect(result.merged).toBe(true);
      const mergedText = await io.readText("chapters/03.md");
      expect(mergedText).toContain("主角拔剑决定留守村庄！");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
