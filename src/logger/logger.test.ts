import { describe, expect, it } from "vitest";
import { createLogger } from "./index.js";

describe("logger", () => {
  it("filters levels and formats compact timestamps", () => {
    const lines: string[] = [];
    const logger = createLogger({ level: "info", write: line => lines.push(line), now: () => new Date("2026-01-01T12:34:56Z") });
    logger.debug("hidden"); logger.info("ready", { module: "x" });
    expect(lines).toEqual([expect.stringMatching(/^12:34:56 level=INFO msg=ready module=x$/)]);
  });
});
