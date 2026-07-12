import { createInterface } from "node:readline/promises";
import { stdin, stderr } from "node:process";
import { defaultConfigPath, fillDefaults, saveConfig } from "./load.js";
import type { Config } from "./schemas.js";
import { validateConfig } from "./validate.js";

export async function runSetup(): Promise<Config> {
  const input = createInterface({ input: stdin, output: stderr });
  try {
    const provider = (await input.question("Provider: ")).trim();
    const apiKey = (await input.question("API Key: ")).trim();
    const baseUrl = (await input.question("Base URL: ")).trim();
    const model = (await input.question("Model: ")).trim();
    const cfg = fillDefaults({
      provider,
      model,
      providers: { [provider]: { ...(apiKey ? { api_key: apiKey } : {}), ...(baseUrl ? { base_url: baseUrl } : {}) } },
      roles: {},
      style: "default",
    });
    validateConfig(cfg);
    await saveConfig(defaultConfigPath(), cfg);
    return cfg;
  } finally {
    input.close();
  }
}
