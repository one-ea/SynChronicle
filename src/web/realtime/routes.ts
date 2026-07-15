import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import type { EventBroker, Unsubscribe } from "../../realtime/broker.js";
import type { RunEventRepository, RunEventScope } from "../../realtime/eventRepository.js";

const ParamsSchema = z.object({ runId: z.string().uuid() }).strict();
const QuerySchema = z.object({ after: z.string().regex(/^\d+$/).transform(Number).refine(Number.isSafeInteger).default("0") }).strict();

interface RealtimeRoutesOptions {
  repository: RunEventRepository;
  broker: EventBroker;
  pageSize?: number;
  maxBufferedBytes?: number;
}

type AuthorizedRequest = FastifyRequest & { realtimeScope?: RunEventScope; realtimeAfter?: number };

export const realtimeRoutes: FastifyPluginAsync<RealtimeRoutesOptions> = async (app, options) => {
  const pageSize = options.pageSize ?? 500;
  const maxBufferedBytes = options.maxBufferedBytes ?? 1024 * 1024;

  app.get("/ws/runs/:runId", {
    websocket: true,
    preValidation: [app.authenticateRequest, async (rawRequest, reply) => {
      const request = rawRequest as AuthorizedRequest;
      if (request.headers.origin !== app.authPublicUrl.origin) return reply.code(403).send({ error: "Forbidden" });
      const params = ParamsSchema.safeParse(request.params);
      const query = QuerySchema.safeParse(request.query);
      if (!params.success || !query.success) return reply.code(400).send({ error: "Invalid request" });
      const scope = await options.repository.findScope(request.auth.userId, params.data.runId);
      if (!scope) return reply.code(404).send({ error: "Run not found" });
      request.realtimeScope = scope;
      request.realtimeAfter = query.data.after;
    }],
  }, (socket, rawRequest) => {
    const request = rawRequest as AuthorizedRequest;
    const scope = request.realtimeScope!;
    let cursor = request.realtimeAfter!;
    let closed = false;
    let draining = false;
    let rerun = false;
    let unsubscribe: Unsubscribe | undefined;

    const cleanup = async () => {
      if (closed) return;
      closed = true;
      await unsubscribe?.();
    };
    socket.once("close", () => void cleanup());
    socket.once("error", () => void cleanup());

    const drain = async (): Promise<void> => {
      if (closed) return;
      if (draining) {
        rerun = true;
        return;
      }
      draining = true;
      try {
        do {
          rerun = false;
          while (!closed) {
            const events = await options.repository.listAfter(scope, cursor, pageSize);
            for (const event of events) {
              if (event.sequence <= cursor) continue;
              if (socket.bufferedAmount > maxBufferedBytes) {
                socket.close(1013, "Slow consumer");
                await cleanup();
                return;
              }
              socket.send(JSON.stringify(event));
              cursor = event.sequence;
            }
            if (events.length < pageSize) break;
          }
        } while (rerun && !closed);
      } finally {
        draining = false;
      }
    };

    void (async () => {
      try {
        await drain();
        unsubscribe = await options.broker.subscribe((wakeup) => {
          if ((!wakeup.runId || wakeup.runId === scope.runId) && wakeup.sequence > cursor) return drain();
        });
        if (closed) await unsubscribe();
        else await drain();
      } catch (error) {
        request.log.error({ err: error }, "run event stream failed");
        socket.close(1011, "Event stream failed");
        await cleanup();
      }
    })();
  });
};
