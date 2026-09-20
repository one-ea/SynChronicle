import { describe, expect, it } from "vitest";
import { EventHub } from "../../worker/hub.js";
import { RuntimeHub } from "../../worker/object.js";

/** 最小 DurableObjectState 桩：storage 异步 get/put 内存实现。 */
function stubState(): { storage: { put(key: string, value: unknown): Promise<void>; get(key: string): Promise<unknown> } } & Record<string, unknown> {
  const backing = new Map<string, unknown>();
  const exposed: Record<string, unknown> = new Map(backing);
  return {
    storage: {
      put: async (key: string, value: unknown) => { backing.set(key, value); exposed[key] = value; },
      get: async (key: string) => backing.get(key),
    },
    backing,
    exposed,
    waitUntil: () => {},
    passThroughOnException: () => {},
  } as never;
}

function stubNamespace() { return { get: () => ({}) }; }

async function readChunks(stream: ReadableStream<Uint8Array>, count: number): Promise<string> {
  const reader = stream.getReader();
  let text = "";
  try {
    for (let index = 0; index < count; index += 1) {
      const { value, done } = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value);
    }
  } finally { await reader.cancel(); }
  return text;
}

describe("runtime hub", () => {
  it("EventHub 回放有界、扇出即时、快照独立", () => {
    const hub = new EventHub(3);
    const seen: string[] = [];
    const unsubscribe = hub.subscribe((event) => seen.push(event.event));
    hub.publish("snapshot", { state: "idle" });
    hub.publish("runtime", { type: "system" });
    hub.publish("delta", { value: "a" });
    hub.publish("delta", { value: "b" });
    hub.publish("delta", { value: "c" });
    hub.publish("delta", { value: "d" });
    expect(seen.filter((name) => name === "delta")).toHaveLength(4);
    expect(hub.replay().map((item) => (item.data as { value: string }).value)).toEqual(["b", "c", "d"]);
    expect(hub.currentSnapshot()).toEqual({ state: "idle" });
    unsubscribe();
    hub.publish("delta", { value: "e" });
    expect(hub.subscriberCount()).toBe(0);
  });

  it("RuntimeHub 摄入令牌校验与 SSE 回放/实时", async () => {
    const state = stubState();
    const hub = new RuntimeHub(state as never, { INTERNAL_TOKEN: "tok-1" });

    const denied = await hub.fetch(new Request("https://do/events", { method: "POST", headers: { "content-type": "application/json", "x-internal-token": "wrong" }, body: JSON.stringify({ event: "runtime", data: {} }) }));
    expect(denied.status).toBe(403);

    const accepted = await hub.fetch(new Request("https://do/events", { method: "POST", headers: { "content-type": "application/json", "x-internal-token": "tok-1" }, body: JSON.stringify({ event: "runtime", data: { type: "system", message: "启动" } }) }));
    expect(accepted.status).toBe(200);

    const snapshotIngest = await hub.fetch(new Request("https://do/events", { method: "POST", headers: { "content-type": "application/json", "x-internal-token": "tok-1" }, body: JSON.stringify({ event: "snapshot", data: { state: "running" } }) }));
    expect(snapshotIngest.status).toBe(200);
    expect(await state.storage.get("snapshot")).toEqual({ state: "running" });

    const stream = await hub.fetch(new Request("https://do/stream"));
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    const body = stream.body as ReadableStream<Uint8Array>;
    const reading = readChunks(body, 3);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await hub.fetch(new Request("https://do/events", { method: "POST", headers: { "content-type": "application/json", "x-internal-token": "tok-1" }, body: JSON.stringify({ event: "delta", data: { value: "live" } }) }));
    const text = await reading;
    expect(text).toContain("event: snapshot");
    expect(text).toContain("启动");
    expect(text).toContain("live");

    const snapshotResponse = await hub.fetch(new Request("https://do/snapshot"));
    const payload = await snapshotResponse.json() as { snapshot: unknown; events: Array<{ data: unknown }> };
    expect(payload.snapshot).toEqual({ state: "running" });
    expect(payload.events.length).toBeGreaterThan(0);
  });

  it("未配置 INTERNAL_TOKEN 时拒绝摄入", async () => {
    const hub = new RuntimeHub(stubState() as never, {});
    const response = await hub.fetch(new Request("https://do/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event: "runtime", data: {} }) }));
    expect(response.status).toBe(403);
  });
});
