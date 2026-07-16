// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "./client.js";

describe("project archive download", () => {
  it("uses a metadata handshake and native anchor navigation without buffering a blob", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ downloadUrl: "/api/projects/p1/export?version=7" }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const createObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL });
    await createApiClient().exportProject("p1", 7);
    expect(fetch).toHaveBeenCalledWith("/api/projects/p1/export-metadata?version=7", expect.objectContaining({ credentials: "same-origin" }));
    expect(click).toHaveBeenCalledOnce();
    expect(createObjectURL).not.toHaveBeenCalled();
    click.mockRestore();
  });
});
