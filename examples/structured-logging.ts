/**
 * @title Structured logging
 * @difficulty beginner
 * @tags workers, logging, observability
 * @group Observability
 * @resource {https://effect.website/docs/observability/logging/} Effect: logging
 * @resource {https://developers.cloudflare.com/workers/observability/logs/workers-logs/} Cloudflare: Workers Logs
 * @check GET /orders/42 -> 200 "order 42"
 *
 * Workers Logs index JSON log lines, so structured logs are searchable by
 * field. Effect's logger writes one JSON object per line when the layer
 * swaps in `Logger.consoleJson`; annotations and spans become fields, so
 * every line of a request carries its request id without passing it around.
 */

import { Effect, Logger } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"
import * as Worker from "@mikepage/flareosaur/workers/worker"

const loadOrder = (id: string) =>
  Effect.gen(function*() {
    yield* Effect.logDebug("cache miss")
    yield* Effect.sleep("5 millis")
    yield* Effect.logInfo("order loaded")
    return { id, total: 99.5 }
  }).pipe(Effect.withLogSpan("loadOrder"))

const handler = Effect.gen(function*() {
  const { id } = yield* HttpRouter.params
  const result = yield* loadOrder(id!)
  return HttpServerResponse.text(`order ${result.id}: ${result.total}`)
})

// Every log line inside gets these fields:
// {"message":"order loaded","logLevel":"INFO","annotations":{"requestId":"...","route":"/orders/:id"},...}
// The id is made per request: Workers forbid generating random values in
// global scope, so `crypto.randomUUID()` must not run when the module loads.
const order = Effect.suspend(() =>
  handler.pipe(Effect.annotateLogs({ requestId: crypto.randomUUID(), route: "/orders/:id" }))
)

export default Worker.make({
  // One JSON object per line, for Workers Logs.
  layer: Logger.layer([Logger.consoleJson]),
  fetch: HttpRouter.add("GET", "/orders/:id", order),
})
