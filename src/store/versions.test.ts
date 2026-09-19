import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileIO } from "./io.js";
import { VersionStore, countWords } from "./versions.js";

async function makeStore(): Promise<VersionStore> {
  const dir = await mkdtemp(join(tmpdir(), "versions-"));
  return new VersionStore(new FileIO(dir));
}

describe("VersionStore 版本时光机", () => {
  it("counts non-whitespace characters", () => {
    expect(countWords("你好 世界\n\t下一行")).toBe(7);
  });

  it("records snapshots newest-first and skips consecutive duplicates", async () => {
    const store = await makeStore();
    expect(await store.record(1, "第一版正文", "commit")).toBe(true);
    expect(await store.record(1, "第一版正文", "commit")).toBe(false);
    expect(await store.record(1, "第二版正文", "studio")).toBe(true);
    const list = await store.list(1);
    expect(list.map((version) => version.source)).toEqual(["studio", "commit"]);
    expect(list[0]!.words).toBe(5);
  });

  it("retrieves a version by id and caps history at thirty entries", async () => {
    const store = await makeStore();
    for (let index = 1; index <= 32; index += 1) await store.record(2, `第${index}版`, "studio");
    const list = await store.list(2);
    expect(list.length).toBe(30);
    expect(list[0]!.text).toBe("第32版");
    expect(list.at(-1)!.text).toBe("第3版");
    const found = await store.get(2, 20);
    expect(found?.text).toBe("第20版");
    expect(await store.get(2, 999)).toBeNull();
  });

  it("ignores empty text and rejects invalid chapters", async () => {
    const store = await makeStore();
    expect(await store.record(3, "  \n ", "studio")).toBe(false);
    await expect(store.record(0, "x", "studio")).rejects.toThrow("chapter must be > 0");
  });
});
