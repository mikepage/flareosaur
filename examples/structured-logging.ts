/**
 * @title Structured logging
 * @difficulty beginner
 * @tags workers, logging, observability
 * @group Basics
 * @resource {https://developers.cloudflare.com/workers/observability/logs/workers-logs/} Cloudflare: Workers Logs
 * @resource {https://developer.mozilla.org/en-US/docs/Web/API/URLPattern} MDN: URLPattern
 * @check GET /orders/42 -> 200 "order 42"
 * @check GET /nope -> 404
 *
 * Workers Logs index the fields of objects passed to `console.log`, so
 * structured logs are searchable by field. A small logger made per request
 * adds the request id and route to every line, without passing them around.
 */

import { delay } from "@mikepage/flareosaur/async/delay";

type Fields = Record<string, unknown>;
type Log = (message: string, fields?: Fields) => void;

// A logger with fields that every line carries. Pass console.log an
// object, not a JSON string: Workers Logs then index each field.
function logger(base: Fields) {
  const at =
    (level: "debug" | "info" | "warn" | "error"): Log => (message, fields) =>
      console[level]({ level, message, ...base, ...fields });
  return {
    debug: at("debug"),
    info: at("info"),
    warn: at("warn"),
    error: at("error"),
  };
}

// A span: logs how long a piece of work took. On Workers the clock only
// moves forward after I/O, so the duration is measured around awaits.
async function span<T>(
  log: Log,
  name: string,
  work: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  try {
    return await work();
  } finally {
    log(`${name} done`, { span: name, durationMs: Date.now() - start });
  }
}

async function loadOrder(log: ReturnType<typeof logger>, id: string) {
  log.debug("cache miss", { orderId: id });
  await delay(5);
  log.info("order loaded", { orderId: id });
  return { id, total: 99.5 };
}

// Parsed once per isolate: the pattern is a settled, immutable value.
const order = new URLPattern({ pathname: "/orders/:id" });

export default {
  async fetch(request) {
    const match = order.exec(request.url);
    if (!match) return new Response("Not Found", { status: 404 });

    // The id is made per request. Workers forbid randomness in global
    // scope. The cf-ray header, when present, links logs to the request.
    const log = logger({
      requestId: request.headers.get("cf-ray") ?? crypto.randomUUID(),
      route: "/orders/:id",
    });
    // {"level":"info","message":"order loaded","requestId":"...","route":"/orders/:id","orderId":"42"}
    const id = match.pathname.groups.id!;
    const result = await span(log.info, "loadOrder", () => loadOrder(log, id));
    return new Response(`order ${result.id}: ${result.total}`);
  },
} satisfies ExportedHandler;
