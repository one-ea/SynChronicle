import { describe, expect, it, vi } from "vitest";
import { evalCommand } from "./eval.js";
import { updateCommand } from "./update.js";
import { formatVersion } from "./version.js";
import { loadPrompt } from "./dispatch.js";

describe("CLI commands", () => {
  it("formats package version metadata", () => {
    expect(formatVersion({ version: "2.0.0", commit: "abc", date: "today" })).toBe("SynChronicle v2.0.0\ncommit: abc\nbuilt: today\n");
  });

  it("rejects invalid eval usage before loading config", async () => {
    const stderr = vi.fn();
    expect(await evalCommand(["--repeat", "0"], { writeStderr: stderr })).toBe(2);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("缺少 --cases"));
  });

  it("parses --judge / --no-judge and rejects conflicting use", async () => {
    const stderr = vi.fn();
    expect(await evalCommand(["--cases", "cases", "--judge", "--no-judge"], { writeStderr: stderr })).toBe(2);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("不能同时使用"));

    const run = vi.fn().mockResolvedValue(0 as const);
    expect(await evalCommand(["--cases", "cases", "--judge", "--ci"], { load: () => [], run })).toBe(0);
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ judge: true, ci: true }));
    expect(await evalCommand(["--cases", "cases", "--no-judge"], { load: () => [], run })).toBe(0);
    expect(run).toHaveBeenLastCalledWith(expect.objectContaining({ judge: false }));
  });

  it("uses injected npm registry and installer", async () => {
    const install = vi.fn().mockResolvedValue(undefined);
    const messages: string[] = [];
    await updateCommand("2.1.0", {
      currentVersion: "2.0.0",
      fetchPackage: vi.fn().mockResolvedValue({ version: "2.1.0" }),
      install,
      writeStdout: (text) => messages.push(text),
    });
    expect(install).toHaveBeenCalledWith("synchronicle@2.1.0");
    expect(messages.join("")).toContain("已更新到 v2.1.0");
  });

  it("loads and trims prompt files through an injected reader", async () => {
    const read = vi.fn().mockResolvedValue("  prompt from file\n");
    await expect(loadPrompt("", "prompt.txt", read)).resolves.toBe("prompt from file");
    expect(read).toHaveBeenCalledWith("prompt.txt");
  });
});
