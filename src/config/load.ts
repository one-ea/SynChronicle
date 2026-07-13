import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { ConfigSchema, ProviderConfigSchema, RoleConfigSchema, BudgetConfigSchema, NotifyConfigSchema, type ConfigInput, type PartialConfig, type ProviderConfig, type ResolvedConfig, type RoleConfig } from "./schemas.js";
import { z } from "zod";

const ConfigFileSchema = z.object({
  output_dir: z.string().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  reasoning_effort: z.string().optional(),
  providers: z.record(ProviderConfigSchema).optional(),
  roles: z.record(RoleConfigSchema.partial()).optional(),
  style: z.string().optional(),
  context_window: z.number().int().optional(),
  budget: BudgetConfigSchema.optional(),
  notify: NotifyConfigSchema.optional(),
});

const configDirName = ".synchronicle";

export function defaultConfigDir(): string {
  return join(process.env.HOME || homedir(), configDirName);
}

export function defaultConfigPath(): string {
  return join(defaultConfigDir(), "config.json");
}

export function projectConfigPath(): string {
  return join(configDirName, "config.json");
}

function stripJsonComments(input: string): string {
  let output = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (escaped) {
      output += char;
      escaped = false;
      continue;
    }
    if (inString) {
      output += char;
      if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }
    if (char === "/" && input[index + 1] === "/") {
      while (index < input.length && input[index] !== "\n") index += 1;
      if (index < input.length) output += "\n";
      continue;
    }
    output += char;
  }
  return output;
}

export async function loadConfigFile(path: string): Promise<PartialConfig> {
  const data = await readFile(path, "utf8");
  try {
    return ConfigFileSchema.parse(JSON.parse(stripJsonComments(data)));
  } catch (error) {
    throw new Error(`parse ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function loadOptional(path: string): Promise<PartialConfig | undefined> {
  try {
    return await loadConfigFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error instanceof Error && error.cause && (error.cause as NodeJS.ErrnoException).code === "ENOENT")) return undefined;
    throw error;
  }
}

function mergeProvider(base: ProviderConfig = {}, overlay: ProviderConfig): ProviderConfig {
  return {
    ...base,
    ...(overlay.type ? { type: overlay.type } : {}),
    ...(overlay.api ? { api: overlay.api } : {}),
    ...(overlay.api_key ? { api_key: overlay.api_key } : {}),
    ...(overlay.base_url ? { base_url: overlay.base_url } : {}),
    ...(overlay.models?.length ? { models: [...overlay.models] } : {}),
    ...(overlay.extra_body && Object.keys(overlay.extra_body).length ? { extra_body: { ...overlay.extra_body } } : {}),
    ...(overlay.extra && Object.keys(overlay.extra).length ? { extra: { ...overlay.extra } } : {}),
  };
}

function mergeRole(base: Partial<RoleConfig> = {}, overlay: Partial<RoleConfig>): RoleConfig {
  return {
    provider: overlay.provider || base.provider || "",
    model: overlay.model || base.model || "",
    ...(overlay.fallbacks?.length ? { fallbacks: [...overlay.fallbacks] } : base.fallbacks ? { fallbacks: [...base.fallbacks] } : {}),
    ...(overlay.reasoning_effort ? { reasoning_effort: overlay.reasoning_effort } : base.reasoning_effort ? { reasoning_effort: base.reasoning_effort } : {}),
  };
}

export function mergeConfig(base: PartialConfig, overlay: PartialConfig): ResolvedConfig {
  const result: PartialConfig = { ...base };
  for (const key of ["provider", "model", "reasoning_effort", "style"] as const) {
    if (overlay[key]) result[key] = overlay[key];
  }
  if ((overlay.context_window ?? 0) > 0) result.context_window = overlay.context_window;
  result.providers = { ...(base.providers ?? {}) };
  for (const [name, provider] of Object.entries(overlay.providers ?? {})) {
    result.providers[name] = mergeProvider(result.providers[name], provider);
  }
  result.roles = { ...(base.roles ?? {}) };
  for (const [role, roleConfig] of Object.entries(overlay.roles ?? {})) {
    result.roles[role] = mergeRole(result.roles[role], roleConfig);
  }
  if (overlay.budget !== undefined) result.budget = { ...overlay.budget };
  if (overlay.notify !== undefined) result.notify = { ...overlay.notify };
  return ConfigSchema.parse(result);
}

export function fillDefaults(input: ConfigInput): ResolvedConfig {
  const parsed = ConfigSchema.parse(input);
  return {
    ...parsed,
    output_dir: parsed.output_dir || join("output", "novel"),
    providers: parsed.providers ?? {},
    roles: parsed.roles ?? {},
    style: parsed.style || "default",
    ...(parsed.budget
      ? {
          budget: {
            ...parsed.budget,
            ...(parsed.budget.book_usd && !parsed.budget.warn_ratio ? { warn_ratio: 0.8 } : {}),
            hard_stop: parsed.budget.hard_stop ?? false,
          },
        }
      : {}),
  };
}

export async function loadConfig(flagPath?: string): Promise<ResolvedConfig> {
  let cfg: PartialConfig = { provider: "", model: "", providers: {}, roles: {} };
  try {
    const global = await loadOptional(defaultConfigPath());
    if (global) cfg = global;
  } catch {
    cfg = { provider: "", model: "", providers: {}, roles: {} };
  }
  try {
    const project = await loadOptional(projectConfigPath());
    if (project) cfg = mergeConfig(cfg, project);
  } catch (error) {
    throw new Error(`项目级配置 ./.synchronicle/config.json 解析失败（请检查 JSON 语法）: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (flagPath) cfg = mergeConfig(cfg, await loadConfigFile(flagPath));
  return fillDefaults(ConfigSchema.parse(cfg));
}

export async function needsSetup(flagPath?: string): Promise<boolean> {
  const paths = flagPath ? [flagPath] : [defaultConfigPath(), projectConfigPath()];
  for (const path of paths) {
    try {
      await access(path);
      return false;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return true;
}

export async function saveConfig(path: string, cfg: ResolvedConfig): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const { output_dir: _outputDir, ...serializable } = cfg;
  await writeFile(path, `${JSON.stringify(serializable, null, 2)}\n`, "utf8");
}
