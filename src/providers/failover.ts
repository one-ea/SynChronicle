import type { LanguageModel } from "ai";
type LanguageModelInstance = Exclude<LanguageModel, string>;

export interface FailoverEvent { role: string; reason: string; fromProvider: string; fromModel: string; toProvider: string; toModel: string; error: unknown }
export type FailoverReporter = (event: FailoverEvent) => void;
export interface ModelTarget { provider: string; model: string; instance: LanguageModelInstance }

function reason(error: unknown): string | undefined {
  if (error instanceof DOMException && error.name === "AbortError") return undefined;
  const value = error as { statusCode?: number; status?: number; code?: string };
  const status = value?.statusCode ?? value?.status;
  if (status === 429) return "rate_limit";
  if (status === 408 || value?.code === "ETIMEDOUT") return "timeout";
  if (typeof status === "number" && status >= 500) return "network";
  return undefined;
}

export function failoverModel(role: string, primary: ModelTarget, fallbacks: ModelTarget[], report?: FailoverReporter): LanguageModelInstance {
  const attempt = async <T>(method: "doGenerate" | "doStream", options: never): Promise<T> => {
    try { return await primary.instance[method](options) as T; }
    catch (error) {
      const why = reason(error);
      const next = fallbacks.find(target => target.provider !== primary.provider || target.model !== primary.model);
      if (!why || !next) throw error;
      report?.({ role, reason: why, fromProvider: primary.provider, fromModel: primary.model, toProvider: next.provider, toModel: next.model, error });
      return await next.instance[method](options) as T;
    }
  };
  return {
    specificationVersion: "v2",
    provider: primary.instance.provider,
    modelId: primary.instance.modelId,
    supportedUrls: primary.instance.supportedUrls,
    doGenerate: options => attempt("doGenerate", options as never),
    doStream: options => attempt("doStream", options as never),
  };
}
