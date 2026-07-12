import { describe, expect, it } from "vitest";
import { checkBrandContract } from "./index.js";

describe("brand", () => {
  it("validates package, license, notice and pack files", () => {
    expect(checkBrandContract(process.cwd(), ["package/dist/cli/index.js", "package/README.md", "package/LICENSE", "package/NOTICE"])).toEqual([]);
  });
});
