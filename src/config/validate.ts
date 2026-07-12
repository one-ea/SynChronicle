import { ConfigSchema, type Config, type PartialConfig } from "./schemas.js";

const knownRoles = new Set(["coordinator", "architect", "writer", "editor"]);
const knownProviders = new Set(["openai", "anthropic", "gemini", "openrouter", "deepseek", "qwen", "glm", "grok", "mimo", "ollama", "bedrock"]);
const knownNotifyEvents = new Set(["run_end", "repeat", "budget"]);

function validateText(label: string, value = ""): void {
  if (/\p{Cc}/u.test(value)) {
    throw new Error(`${label} contains control character`);
  }
}

function requiresApiKey(name: string, type?: string): boolean {
  return name !== "ollama" && name !== "bedrock" && !type;
}

function providerType(name: string, type?: string): string {
  if (type) return type;
  if (knownProviders.has(name)) return name;
  throw new Error(`provider ${JSON.stringify(name)} 缺少 type，且不在已知 provider 列表中`);
}

function validateProvider(name: string, owner: string, cfg: Config): void {
  const provider = cfg.providers[name];
  if (!provider) throw new Error(`${owner} references provider ${JSON.stringify(name)} which is not configured`);
  if (requiresApiKey(name, provider.type) && !provider.api_key) {
    throw new Error(`${owner} references provider ${JSON.stringify(name)} which has no api_key`);
  }
  validateText(`provider ${JSON.stringify(name)} type`, provider.type);
  validateText(`provider ${JSON.stringify(name)} api`, provider.api);
  validateText(`provider ${JSON.stringify(name)} api_key`, provider.api_key);
  validateText(`provider ${JSON.stringify(name)} base_url`, provider.base_url);
  provider.models?.forEach((model, index) => validateText(`provider ${JSON.stringify(name)} models[${index}]`, model));
  if (provider.api && provider.api !== "chat" && provider.api !== "responses") {
    throw new Error(`provider ${JSON.stringify(name)} api must be chat or responses`);
  }
  if (provider.api && providerType(name, provider.type).trim().toLowerCase() !== "openai") {
    throw new Error(`${owner} provider ${JSON.stringify(name)} api 仅支持 OpenAI 协议 provider`);
  }
}

export function validateConfig(input: PartialConfig): void {
  const cfg: Config = ConfigSchema.parse({ providers: {}, roles: {}, ...input });
  validateText("provider", cfg.provider);
  validateText("model", cfg.model);
  if (!cfg.provider) throw new Error("provider is required");
  if (!cfg.model) throw new Error("model is required");
  validateProvider(cfg.provider, "default", cfg);
  for (const name of Object.keys(cfg.providers)) validateProvider(name, `provider ${JSON.stringify(name)}`, cfg);
  for (const [role, roleConfig] of Object.entries(cfg.roles ?? {})) {
    if (!knownRoles.has(role)) throw new Error(`unknown role ${JSON.stringify(role)} in roles config`);
    validateText(`role ${JSON.stringify(role)} provider`, roleConfig.provider);
    validateText(`role ${JSON.stringify(role)} model`, roleConfig.model);
    if (!roleConfig.provider || !roleConfig.model) throw new Error(`role ${JSON.stringify(role)} must have both provider and model`);
    validateProvider(roleConfig.provider, `role ${JSON.stringify(role)}`, cfg);
    for (const [index, fallback] of (roleConfig.fallbacks ?? []).entries()) {
      if (!fallback.provider || !fallback.model) throw new Error(`role ${JSON.stringify(role)} fallback[${index}] must have both provider and model`);
      validateProvider(fallback.provider, `role ${JSON.stringify(role)} fallback[${index}]`, cfg);
    }
  }
  const budget = cfg.budget;
  if ((budget?.book_usd ?? 0) < 0) throw new Error("budget.book_usd must be >= 0");
  if ((budget?.book_usd ?? 0) > 0 && ((budget?.warn_ratio ?? 0) <= 0 || (budget?.warn_ratio ?? 0) >= 1)) {
    throw new Error("budget.warn_ratio must be in (0, 1)");
  }
  validateText("notify.command", cfg.notify?.command);
  for (const event of cfg.notify?.events ?? []) {
    if (!knownNotifyEvents.has(event)) throw new Error(`unknown notify event ${JSON.stringify(event)}`);
  }
}
