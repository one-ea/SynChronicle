import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectTypeOf } from "vitest";
import {
  ConfigSchema,
  fillDefaults,
  loadConfig,
  loadConfigFile,
  mergeConfig,
  needsSetup,
  resolveContextWindow,
  resolveImportPath,
  resolveReasoningEffort,
  saveConfig,
  validateConfig,
} from "./index.js";
import type { Config, ResolvedConfig } from "./index.js";

const originalCwd = process.cwd();
const originalHome = process.env.HOME;

afterEach(() => {
  process.chdir(originalCwd);
  process.env.HOME = originalHome;
  vi.restoreAllMocks();
});

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "synchronicle-config-"));
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(value), "utf8");
}

const baseConfig = {
  provider: "openrouter",
  model: "model-a",
  providers: { openrouter: { api_key: "test-key" } },
};

describe("config schemas and validation", () => {
  it("keeps config input compatible while exposing normalized reflection", () => {
    const compatibleConfig: Config = baseConfig;
    expect(compatibleConfig.reflection).toBeUndefined();
    expectTypeOf<ResolvedConfig["reflection"]>().toEqualTypeOf<{
      enabled: boolean;
      max_rounds: number;
      pass_threshold: number;
      review_retry_limit: number;
      reviewer_model?: string;
    }>();
  });

  it("applies reflection defaults and validates max rounds", () => {
    expect(ConfigSchema.parse(baseConfig).reflection).toEqual({
      enabled: true,
      max_rounds: 3,
      pass_threshold: 85,
      review_retry_limit: 2,
    });
    expect(() => ConfigSchema.parse({
      ...baseConfig,
      reflection: { max_rounds: 4 },
    })).toThrow();
  });

  it("parses the repository JSONC example without losing compatibility fields", async () => {
    const cfg = await loadConfigFile(join(originalCwd, "config.example.jsonc"));
    expect(ConfigSchema.parse(cfg).providers.openrouter).toMatchObject({
      extra_body: { temperature: 0.8, min_p: 0.05 },
      extra: { user_agent: "my-client/1.0" },
    });
    expect(ConfigSchema.parse(cfg).providers["codex-proxy"]).toMatchObject({ api: "responses", type: "openai" });
  });

  it.each(["ollama", "bedrock"])("allows %s without api_key", (provider) => {
    expect(() => validateConfig({ provider, model: "m", providers: { [provider]: {} } })).not.toThrow();
  });

  it("allows an explicitly typed custom provider without api_key", () => {
    expect(() =>
      validateConfig({ provider: "proxy", model: "m", providers: { proxy: { type: "openai" } } }),
    ).not.toThrow();
  });

  it("rejects missing credentials, unknown roles, invalid API modes, and invalid policies", () => {
    expect(() => validateConfig({ provider: "openai", model: "m", providers: { openai: {} } })).toThrow(/api_key/);
    expect(() => validateConfig({ ...baseConfig, roles: { narrator: { provider: "openrouter", model: "m" } } })).toThrow(/unknown role/);
    expect(() => validateConfig({ provider: "anthropic", model: "m", providers: { anthropic: { api_key: "x", api: "responses" } } })).toThrow(/OpenAI/);
    expect(() => validateConfig({ ...baseConfig, budget: { book_usd: 1, warn_ratio: 1 } })).toThrow(/warn_ratio/);
    expect(() => validateConfig({ ...baseConfig, notify: { events: ["unknown"] } })).toThrow(/notify event/);
  });
});

describe("config loading and merging", () => {
  it("loads global, project, and flag config in priority order with field-wise map merging", async () => {
    const home = await tempDir();
    const project = await tempDir();
    process.env.HOME = home;
    process.chdir(project);
    await writeJson(join(home, ".synchronicle", "config.json"), {
      ...baseConfig,
      reasoning_effort: "low",
      providers: { openrouter: { api_key: "global-key", api: "chat", extra_body: { temperature: 1 } } },
      roles: { writer: { provider: "openrouter", model: "global-model", reasoning_effort: "low" } },
    });
    await writeJson(join(project, ".synchronicle", "config.json"), {
      model: "project-model",
      providers: { openrouter: { base_url: "https://project.example/v1", extra_body: { min_p: 0.1 } } },
      roles: { writer: { model: "project-writer" } },
      budget: { book_usd: 10 },
    });
    const flag = join(project, "override.jsonc");
    await writeFile(flag, `{// flag wins\n"style":"suspense","context_window":300000}`, "utf8");

    const cfg = await loadConfig(flag);
    expect(cfg).toMatchObject({ provider: "openrouter", model: "project-model", style: "suspense", context_window: 300000 });
    expect(cfg.providers.openrouter).toMatchObject({ api_key: "global-key", base_url: "https://project.example/v1", extra_body: { min_p: 0.1 } });
    expect(cfg.roles.writer).toMatchObject({ provider: "openrouter", model: "project-writer", reasoning_effort: "low" });
    expect(cfg.budget).toEqual({ book_usd: 10, warn_ratio: 0.8, hard_stop: false });
  });

  it("ignores corrupt global config when an explicit valid config is present", async () => {
    const home = await tempDir();
    const project = await tempDir();
    process.env.HOME = home;
    process.chdir(project);
    await mkdir(join(home, ".synchronicle"), { recursive: true });
    await writeFile(join(home, ".synchronicle", "config.json"), "{bad", "utf8");
    const flag = join(project, "valid.json");
    await writeJson(flag, baseConfig);
    await expect(loadConfig(flag)).resolves.toMatchObject(baseConfig);
  });

  it("fails loudly for corrupt project config", async () => {
    const home = await tempDir();
    const project = await tempDir();
    process.env.HOME = home;
    process.chdir(project);
    await mkdir(join(project, ".synchronicle"), { recursive: true });
    await writeFile(join(project, ".synchronicle", "config.json"), "{bad", "utf8");
    await expect(loadConfig()).rejects.toThrow(/项目级配置/);
  });

  it("preserves zero overlay values and replaces policy blocks", () => {
    const merged = mergeConfig(
      { ...fillDefaults(baseConfig), budget: { book_usd: 10, warn_ratio: 0.7, hard_stop: true }, notify: { enabled: true, events: ["budget"] } },
      { budget: { book_usd: 0 }, notify: { enabled: false } },
    );
    expect(merged.budget).toEqual({ book_usd: 0 });
    expect(merged.notify).toEqual({ enabled: false });
  });
});

describe("config helpers", () => {
  it("fills defaults and resolves role reasoning effort", () => {
    const cfg = fillDefaults({ ...baseConfig, reasoning_effort: "low", roles: { writer: { provider: "openrouter", model: "m", reasoning_effort: "high" } } });
    expect(cfg).toMatchObject({ output_dir: join("output", "novel"), style: "default", roles: cfg.roles, providers: cfg.providers });
    expect(resolveReasoningEffort(cfg, "writer")).toBe("high");
    expect(resolveReasoningEffort(cfg, "editor")).toBe("low");
  });

  it("resolves explicit, known, and fallback context windows", () => {
    expect(resolveContextWindow({ ...fillDefaults(baseConfig), context_window: 123 }, "unknown")).toEqual({ window: 123, source: "config" });
    expect(resolveContextWindow(fillDefaults(baseConfig), "gpt-4o")).toEqual({ window: 128000, source: "registry" });
    expect(resolveContextWindow(fillDefaults(baseConfig), "unknown-model")).toEqual({ window: 200000, source: "default" });
  });

  it("expands home import paths only for ~/ prefixes", () => {
    process.env.HOME = "/home/tester";
    expect(resolveImportPath("~/draft.txt")).toBe(join("/home/tester", "draft.txt"));
    expect(resolveImportPath("relative.txt")).toBe("relative.txt");
  });

  it("checks setup state and saves JSON config", async () => {
    const home = await tempDir();
    const project = await tempDir();
    process.env.HOME = home;
    process.chdir(project);
    await expect(needsSetup()).resolves.toBe(true);
    const path = join(home, ".synchronicle", "config.json");
    await saveConfig(path, fillDefaults(baseConfig));
    await expect(needsSetup()).resolves.toBe(false);
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject(baseConfig);
  });
});
