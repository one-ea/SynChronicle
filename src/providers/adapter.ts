import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import type { ProviderConfig } from "../config/schemas.js";
type LanguageModelInstance = Exclude<LanguageModel, string>;
import { withExtra } from "./extra.js";
import { resolveProviderType } from "./mapping.js";
import { createResponsesModel } from "./responses.js";
import { createSecureProviderFetch } from "./urlPolicy.js";

interface OpenAIProviderLike { chat(model: string): LanguageModelInstance; responses(model: string): LanguageModelInstance }
interface ProviderFactories {
  openai(options: Parameters<typeof createOpenAI>[0]): OpenAIProviderLike;
  anthropic(options: Parameters<typeof createAnthropic>[0]): ReturnType<typeof createAnthropic>;
  google(options: Parameters<typeof createGoogleGenerativeAI>[0]): ReturnType<typeof createGoogleGenerativeAI>;
}

const defaults: ProviderFactories = { openai: createOpenAI, anthropic: createAnthropic, google: createGoogleGenerativeAI };

export function createProvider(name: string, pc: ProviderConfig, model: string, factories: Partial<ProviderFactories> = {}): LanguageModelInstance {
  const type = resolveProviderType(name, pc.type);
  const baseFetch = pc.base_url ? createSecureProviderFetch() : globalThis.fetch;
  const fetch = pc.extra_body || pc.extra ? withExtra(baseFetch, pc.extra_body, pc.extra) : pc.base_url ? baseFetch : undefined;
  if (type === "anthropic") return (factories.anthropic ?? defaults.anthropic)({ apiKey: pc.api_key, baseURL: pc.base_url, fetch })(model);
  if (type === "google") return (factories.google ?? defaults.google)({ apiKey: pc.api_key, baseURL: pc.base_url, fetch })(model);
  if (type === "bedrock") throw new Error("bedrock provider adapter is not installed");
  const provider = (factories.openai ?? defaults.openai)({ apiKey: pc.api_key, baseURL: pc.base_url, name, fetch });
  return pc.api === "responses" ? createResponsesModel(provider, model) : provider.chat(model);
}
