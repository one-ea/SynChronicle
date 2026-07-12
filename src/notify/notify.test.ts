import { describe, expect, it, vi } from "vitest";
import { Notifier } from "./index.js";

describe("Notifier", () => {
  it("filters events and sends asynchronously through injection", async () => {
    const deliver = vi.fn(async () => undefined);
    const notifier = new Notifier("custom", ["budget"], { deliver });
    notifier.send({ kind: "run_end", level: "info", title: "x", body: "y" });
    notifier.send({ kind: "budget", level: "warn", title: "x", body: "y" });
    await vi.waitFor(() => expect(deliver).toHaveBeenCalledTimes(1));
  });
});
