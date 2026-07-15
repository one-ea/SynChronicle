import type { LanguageModel } from "ai";
import type { ProviderConfig } from "../config/schemas.js";
import { createProvider } from "./adapter.js";

type LanguageModelInstance = Exclude<LanguageModel, string>;
export interface CredentialLease { apiKey: string; baseUrl?: string; release(): void }
export type CredentialResolver = (credentialId: string, provider: string) => Promise<CredentialLease>;
export type ScopedProviderFactory = typeof createProvider;

export function credentialScopedModel(provider: string, model: string, credentialId: string, base: ProviderConfig, resolve: CredentialResolver, factory: ScopedProviderFactory = createProvider): LanguageModelInstance {
  async function invoke(method: "doGenerate" | "doStream", options: unknown) {
    const lease = await resolve(credentialId, provider);
    try {
      const instance = factory(provider, { ...base, api_key: lease.apiKey, base_url: lease.baseUrl ?? base.base_url }, model) as unknown as Record<string, (value: unknown) => unknown>;
      const operation = instance[method];
      if (typeof operation !== "function") throw new Error(`provider model does not implement ${method}`);
      return await operation.call(instance, options);
    } finally {
      lease.release();
    }
  }
  return {
    specificationVersion: "v2",
    provider,
    modelId: model,
    supportedUrls: {},
    doGenerate: (options: unknown) => invoke("doGenerate", options),
    doStream: (options: unknown) => invoke("doStream", options),
  } as LanguageModelInstance;
}
