import websocket, { type WebSocket } from "@fastify/websocket";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type { RequestAuth } from "../auth/plugin.js";
import { InMemoryEventBroker, type EventWakeup } from "../../realtime/broker.js";
import type { RunEvent, RunEventRepository, RunEventScope } from "../../realtime/eventRepository.js";
import { exceedsBackpressure, realtimeRoutes } from "./routes.js";

const alice: RequestAuth = { userId: "alice", role: "user", sessionId: "session-a" };
const scope: RunEventScope = { userId: alice.userId, projectId: "project-a", runId: "00000000-0000-4000-8000-000000000001" };

class MemoryEvents implements RunEventRepository {
  readonly events: RunEvent[] = [];
  readonly scopes = new Map([[scope.runId, scope]]);
  afterList: (() => void | Promise<void>) | undefined;

  async findScope(userId: string, runId: string) {
    const candidate = this.scopes.get(runId);
    return candidate?.userId === userId ? candidate : undefined;
  }

  async appendEvent(eventScope: RunEventScope, event: Omit<RunEvent, "id" | "sequence" | "createdAt" | keyof RunEventScope>) {
    const value: RunEvent = { ...eventScope, ...event, id: `event-${this.events.length + 1}`, sequence: this.events.filter(({ runId }) => runId === eventScope.runId).length + 1, createdAt: new Date() };
    this.events.push(value);
    return value;
  }

  async listAfter(eventScope: RunEventScope, sequence: number, limit: number) {
    const values = this.events.filter((event) => event.runId === eventScope.runId && event.sequence > sequence).sort((a, b) => a.sequence - b.sequence).slice(0, limit);
    await this.afterList?.();
    this.afterList = undefined;
    return values;
  }
}

const apps: Array<ReturnType<typeof Fastify>> = [];
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

async function testApp(repository = new MemoryEvents(), broker = new InMemoryEventBroker(), maxBufferedBytes = 64_000) {
  const app = Fastify();
  apps.push(app);
  app.decorateRequest("auth");
  app.decorate("authPublicUrl", new URL("https://app.example.test"));
  app.decorate("authenticateRequest", async (request, reply) => {
    if (request.headers.cookie !== "session=valid") return reply.code(401).send({ error: "Unauthorized" });
    request.auth = { ...alice, userId: String(request.headers["x-user-id"] ?? alice.userId) };
  });
  await app.register(websocket);
  await app.register(realtimeRoutes, { repository, broker, pageSize: 2, maxBufferedBytes });
  await app.ready();
  return { app, repository, broker };
}

function event(sequence: number): RunEvent {
  return { ...scope, id: `event-${sequence}`, sequence, stableId: `stable-${sequence}`, type: "system", payload: { sequence }, createdAt: new Date(sequence * 1000) };
}

async function connect(app: ReturnType<typeof Fastify>, url: string, headers = upgrade()) {
  const queued: Record<string, unknown>[] = [];
  const waiting: Array<(value: Record<string, unknown>) => void> = [];
  const socket = await app.injectWS(url, headers, {
    onInit(client: WebSocket) {
      client.on("message", (message: { toString(): string }) => {
        const value = JSON.parse(message.toString()) as Record<string, unknown>;
        const resolve = waiting.shift();
        if (resolve) resolve(value);
        else queued.push(value);
      });
    },
  });
  return {
    socket,
    nextJson: () => queued.length ? Promise.resolve(queued.shift()!) : new Promise<Record<string, unknown>>((resolve) => waiting.push(resolve)),
  };
}

const upgrade = (userId = alice.userId, origin = "https://app.example.test") => ({ headers: { cookie: "session=valid", origin, "x-user-id": userId } });

describe("run event websocket", () => {
  it("delivers the production stream.delta payload without reshaping it", async () => {
    const { app, repository } = await testApp();
    repository.events.push({ ...event(1), type: "stream.delta", payload: { taskId: "task-1", agent: "Writer", chunkSequence: 1, text: "潮声" } });
    const client = await connect(app, `/ws/runs/${scope.runId}?after=0`);
    expect(await client.nextJson()).toMatchObject({ sequence: 1, type: "stream.delta", payload: { agent: "Writer", text: "潮声" } });
    client.socket.terminate();
  });

  it("replays every event strictly after the cursor before live events", async () => {
    const { app, repository, broker } = await testApp();
    repository.events.push(event(1), event(2), event(3));
    const client = await connect(app, `/ws/runs/${scope.runId}?after=1`);

    expect(await client.nextJson()).toMatchObject({ sequence: 2 });
    expect(await client.nextJson()).toMatchObject({ sequence: 3 });
    repository.events.push(event(4));
    await broker.publish({ runId: scope.runId, sequence: 4 });
    expect(await client.nextJson()).toMatchObject({ sequence: 4 });
    client.socket.terminate();
  });

  it("closes the replay-subscribe race and suppresses duplicate and out-of-order wakeups", async () => {
    const repository = new MemoryEvents();
    const broker = new InMemoryEventBroker();
    repository.events.push(event(1));
    let inserted = false;
    repository.afterList = async () => {
      if (inserted) return;
      inserted = true;
      repository.events.push(event(2));
      await broker.publish({ runId: scope.runId, sequence: 2 });
    };
    const { app } = await testApp(repository, broker);
    const client = await connect(app, `/ws/runs/${scope.runId}?after=0`);

    expect(await client.nextJson()).toMatchObject({ sequence: 1 });
    expect(await client.nextJson()).toMatchObject({ sequence: 2 });
    repository.events.push(event(3));
    await broker.publish({ runId: scope.runId, sequence: 3 });
    await broker.publish({ runId: scope.runId, sequence: 2 });
    await broker.publish({ runId: scope.runId, sequence: 3 });
    expect(await client.nextJson()).toMatchObject({ sequence: 3 });
    client.socket.terminate();
  });

  it("resumes from the last received sequence across a disconnect window", async () => {
    const { app, repository } = await testApp();
    repository.events.push(event(1));
    const first = await connect(app, `/ws/runs/${scope.runId}?after=0`);
    expect(await first.nextJson()).toMatchObject({ sequence: 1 });
    first.socket.terminate();
    repository.events.push(event(2), event(3));

    const resumed = await connect(app, `/ws/runs/${scope.runId}?after=1`);
    expect(await resumed.nextJson()).toMatchObject({ sequence: 2 });
    expect(await resumed.nextJson()).toMatchObject({ sequence: 3 });
    resumed.socket.terminate();
  });

  it("rejects missing sessions, foreign origins, foreign users, and invalid cursors before upgrade", async () => {
    const { app } = await testApp();
    await expect(app.injectWS(`/ws/runs/${scope.runId}?after=0`, { headers: { origin: "https://app.example.test" } })).rejects.toThrow("401");
    await expect(app.injectWS(`/ws/runs/${scope.runId}?after=0`, upgrade(alice.userId, "https://evil.example"))).rejects.toThrow("403");
    await expect(app.injectWS(`/ws/runs/${scope.runId}?after=0`, upgrade("bob"))).rejects.toThrow("404");
    await expect(app.injectWS(`/ws/runs/${scope.runId}?after=-1`, upgrade())).rejects.toThrow("400");
  });

  it("isolates wakeups by run and removes subscriptions when clients close", async () => {
    const { app, repository, broker } = await testApp();
    repository.events.push(event(1));
    const socket = await app.injectWS(`/ws/runs/${scope.runId}?after=1`, upgrade());
    expect(broker.subscriberCount).toBe(1);
    await broker.publish({ runId: "00000000-0000-4000-8000-000000000099", sequence: 99 });
    socket.terminate();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(broker.subscriberCount).toBe(0);
  });

  it("closes slow consumers with a retryable status and cleans up", async () => {
    const repository = new MemoryEvents();
    const broker = new InMemoryEventBroker();
    repository.events.push(event(1));
    const { app } = await testApp(repository, broker, -1);
    const client = await connect(app, `/ws/runs/${scope.runId}?after=0`);
    const close = new Promise<{ code: number; reason: string }>((resolve) => {
      client.socket.once("close", (code: number, reason: { toString(): string }) => resolve({ code, reason: reason.toString() }));
    });

    await expect(close).resolves.toEqual({ code: 1013, reason: "Slow consumer" });
    expect(broker.subscriberCount).toBe(0);
  });

  it("closes and unsubscribes when an asynchronous wakeup pull fails", async () => {
    const repository = new MemoryEvents();
    const broker = new InMemoryEventBroker();
    const { app } = await testApp(repository, broker);
    const client = await connect(app, `/ws/runs/${scope.runId}?after=0`);
    repository.afterList = () => { throw new Error("database unavailable"); };
    const close = new Promise<{ code: number; reason: string }>((resolve) => {
      client.socket.once("close", (code: number, reason: { toString(): string }) => resolve({ code, reason: reason.toString() }));
    });

    await broker.publish({ runId: scope.runId, sequence: 1 });
    await expect(close).resolves.toEqual({ code: 1011, reason: "Event stream failed" });
    expect(broker.subscriberCount).toBe(0);
  });

  it("clears active subscriptions when the server closes", async () => {
    const repository = new MemoryEvents();
    const broker = new InMemoryEventBroker();
    const { app } = await testApp(repository, broker);
    await connect(app, `/ws/runs/${scope.runId}?after=0`);
    expect(broker.subscriberCount).toBe(1);

    await app.close();
    expect(broker.subscriberCount).toBe(0);
  });
});

describe("backpressure accounting", () => {
  it("includes the serialized message bytes for a single oversized event", () => {
    expect(exceedsBackpressure(0, "€", 2)).toBe(true);
  });

  it("combines queued bytes with the next serialized message", () => {
    expect(exceedsBackpressure(8, "abc", 10)).toBe(true);
    expect(exceedsBackpressure(7, "abc", 10)).toBe(false);
  });
});

describe("event broker", () => {
  it("fans out wakeups and supports idempotent cleanup", async () => {
    const broker = new InMemoryEventBroker();
    const received: EventWakeup[] = [];
    const unsubscribe = await broker.subscribe((wakeup) => { received.push(wakeup); });
    await broker.publish({ runId: scope.runId, sequence: 1 });
    await unsubscribe();
    await unsubscribe();
    await broker.publish({ runId: scope.runId, sequence: 2 });
    expect(received).toEqual([{ runId: scope.runId, sequence: 1 }]);
  });
});
