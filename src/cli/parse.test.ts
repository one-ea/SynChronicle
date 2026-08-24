import { describe, expect, it } from "vitest";
import { parseCLIOptions } from "./parse.js";

describe("parseCLIOptions", () => {
  it("parses startup flags", () => {
    expect(parseCLIOptions(["--config", "x.json", "--headless", "--prompt", "write"])).toEqual({
      command: "start", configPath: "x.json", headless: true, web: true, port: 3000, prompt: "write", promptFile: "", args: [],
    });
  });

  it("defaults to the WebUI and accepts a custom port", () => {
    expect(parseCLIOptions(["--port", "4317"])).toMatchObject({ command: "start", headless: false, web: true, port: 4317 });
  });

  it.each([["--version"], ["-v"], ["version"]])("parses version alias %j", (...argv) => {
    expect(parseCLIOptions(argv).command).toBe("version");
  });

  it("parses update target and eval independently", () => {
    expect(parseCLIOptions(["update", "1.2.3"])).toMatchObject({ command: "update", updateVersion: "1.2.3" });
    expect(parseCLIOptions(["eval", "--cases", "cases"])).toEqual({ command: "eval", argv: ["--cases", "cases"] });
  });

  it.each([
    [["--prompt", "x", "--prompt-file", "p"], /不能同时使用/],
    [["--prompt", "x"], /仅能在 --headless/],
    [["version", "extra"], /version 不接受参数/],
    [["update", "1", "2"], /只接受一个可选版本参数/],
    [["--version", "--headless"], /version 不能与其他启动参数混用/],
  ])("rejects incompatible arguments", (argv, message) => {
    expect(() => parseCLIOptions(argv as string[])).toThrow(message as RegExp);
  });
});
