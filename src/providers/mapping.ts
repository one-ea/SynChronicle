const types: Record<string, string> = {
  openai: "openai", anthropic: "anthropic", gemini: "google", google: "google",
  openrouter: "openai", deepseek: "openai", qwen: "openai", glm: "openai",
  grok: "openai", ollama: "openai", bedrock: "bedrock",
};

export function knownProviderType(name: string): string | undefined {
  return types[name.trim().toLowerCase()];
}

export function resolveProviderType(name: string, explicit?: string): string {
  const type = explicit?.trim().toLowerCase() || knownProviderType(name);
  if (!type) throw new Error(`provider ${JSON.stringify(name)} 缺少 type，且不在已知 provider 列表中`);
  return type;
}
