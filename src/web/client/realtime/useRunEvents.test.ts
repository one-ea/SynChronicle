// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reconnectDelay, useRunEvents } from "./useRunEvents.js";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readonly listeners = new Map<string, Array<(event: any) => void>>();
  constructor(readonly url: string) { FakeWebSocket.instances.push(this); }
  addEventListener(type: string, listener: (event: any) => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  emit(type: string, event: any = {}) { for (const listener of this.listeners.get(type) ?? []) listener(event); }
  close() {}
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  FakeWebSocket.instances = [];
});

describe("reconnectDelay", () => {
  it("grows across consecutive 1013 closes, caps, and applies injectable jitter", () => {
    expect(reconnectDelay(1, () => 0)).toBe(800);
    expect(reconnectDelay(2, () => 0)).toBe(1600);
    expect(reconnectDelay(9, () => 0)).toBe(15_000);
    expect(reconnectDelay(2, () => 1)).toBe(2400);
  });

  it("keeps exponential attempts across unstable opens and resets after a received event", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const hook = renderHook(() => useRunEvents({ runId: "11111111-1111-4111-8111-111111111111" }));
    const first = FakeWebSocket.instances[0]!;
    act(() => { first.emit("open"); first.emit("close", { code: 1013 }); vi.advanceTimersByTime(800); });
    const second = FakeWebSocket.instances[1]!;
    act(() => { second.emit("open"); second.emit("close", { code: 1013 }); vi.advanceTimersByTime(1599); });
    expect(FakeWebSocket.instances).toHaveLength(2);
    act(() => vi.advanceTimersByTime(1));
    const third = FakeWebSocket.instances[2]!;
    await act(async () => {
      third.emit("open");
      third.emit("message", { data: JSON.stringify({ sequence: 1, type: "stream.delta", payload: { text: "x" } }) });
    });
    expect(hook.result.current.state.lastSequence).toBe(1);
    act(() => {
      third.emit("close", { code: 1013 });
      vi.advanceTimersByTime(800);
    });
    expect(FakeWebSocket.instances).toHaveLength(4);
    expect(FakeWebSocket.instances[3]!.url).toContain("after=1");
  });
});
