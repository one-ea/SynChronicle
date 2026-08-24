import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { renderWebApp } from "./app.js";
import { startWebServer } from "./server.js";

describe("WebUI", () => {
  it("renders a studio shell with a prompt and live status regions", () => {
    const html = renderWebApp();
    expect(html).toContain("SynChronicle");
    expect(html).toContain("开始创作");
    expect(html).toContain("data-testid=\"runtime-status\"");
    expect(html).toContain("/api/run");
    expect(html).toContain("data-testid=\"config-form\"");
  });

  it("keeps first-run setup explicit and accessible", () => {
    const html = renderWebApp();
    expect(html).toContain("先保存配置后开始");
    expect(html).toContain('label for="model-input"');
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain("A room for long-form worlds");
  });

  it("exposes recovery and steering states without unsafe event rendering", () => {
    const html = renderWebApp();
    expect(html).toContain('aria-current="step"');
    expect(html).toContain("发送干预");
    expect(html).toContain("恢复上一轮");
    expect(html).toContain("Ctrl + Enter");
    expect(html).toContain('role="log"');
    expect(html).not.toContain("innerHTML =");
    expect(html).toContain("feed.replaceChildren()");
    expect(html).toContain("matchMedia('(prefers-reduced-motion: reduce)')");
  });

  it("serves the WebUI and health endpoint without a model configuration", async () => {
    const handle = await startWebServer({ port: 0, configPath: "/tmp/synchronicle-test-missing-config.json" });
    try {
      const root = await fetch(`http://127.0.0.1:${handle.port}/`);
      expect(root.status).toBe(200);
      expect(await root.text()).toContain("SynChronicle");

      const health = await fetch(`http://127.0.0.1:${handle.port}/api/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ ok: true });

      const status = await fetch(`http://127.0.0.1:${handle.port}/api/status`);
      expect(status.status).toBe(200);
      expect(await status.json()).toMatchObject({ configured: false });
    } finally {
      await handle.close();
    }
  });

  it("saves a local provider configuration through the WebUI", async () => {
    const directory = await mkdtemp(join(tmpdir(), "synchronicle-web-config-"));
    const configPath = join(directory, "config.json");
    const handle = await startWebServer({ port: 0, configPath });
    try {
      const saved = await fetch(`http://127.0.0.1:${handle.port}/api/config`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "ollama", model: "qwen3:14b", baseUrl: "http://localhost:11434/v1" }),
      });
      expect(saved.status).toBe(201);
      expect(await saved.json()).toEqual({ configured: true });

      const status = await fetch(`http://127.0.0.1:${handle.port}/api/status`);
      expect(await status.json()).toMatchObject({ configured: true });
    } finally {
      await handle.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
