import type { ModelMessage } from "ai";
import { encode } from "gpt-tokenizer";

export interface ContextManagerOptions {
  window: number;
  pack?: (messages: readonly ModelMessage[]) => ModelMessage[];
}

export class ContextManager {
  readonly window: number;
  readonly threshold: number;
  readonly reserve: number;
  private readonly packer: (messages: readonly ModelMessage[]) => ModelMessage[];

  constructor({ window, pack = (messages) => [...messages] }: ContextManagerOptions) {
    if (!Number.isFinite(window) || window <= 0) throw new Error("context window must be greater than zero");
    this.window = Math.floor(window);
    this.threshold = Math.floor(this.window * 0.85);
    this.reserve = Math.max(8000, Math.floor(this.window * 0.15));
    this.packer = pack;
  }

  estimate(messages: readonly ModelMessage[]): number {
    return messages.reduce((total, message) => total + encode(JSON.stringify(message)).length + 4, 0);
  }

  pack(messages: readonly ModelMessage[]): ModelMessage[] {
    return this.packer(messages);
  }

  async compress(messages: readonly ModelMessage[]): Promise<ModelMessage[]> {
    const packed = this.pack(messages);
    if (this.estimate(packed) <= this.threshold) return packed;
    const kept: ModelMessage[] = [];
    for (let index = packed.length - 1; index >= 0; index--) {
      const message = packed[index];
      if (!message) continue;
      const candidate = [message, ...kept];
      if (kept.length > 0 && this.estimate(candidate) > this.reserve) break;
      kept.unshift(message);
    }
    return kept;
  }
}
