import type { LanguageModel } from "ai";
type LanguageModelInstance = Exclude<LanguageModel, string>;

export interface ResponsesProvider { responses(model: string): LanguageModelInstance }

export function createResponsesModel(provider: ResponsesProvider, model: string): LanguageModelInstance {
  return provider.responses(model);
}
