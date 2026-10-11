/**
 * @title Request timeouts
 * @difficulty intermediate
 * @tags workers, http
 * @group HTTP
 * @resource {https://effect.website/docs/getting-started/control-flow/} Effect: timeouts
 * @check GET /fast -> 200 "fast answer"
 * @check GET /slow -> 504 "took too long"
 *
 * A handler that waits on a slow upstream can hold a request open far too
 * long. Give the handler a budget with `Effect.timeout`: when it runs out
 * the work is interrupted, not left running, and the client gets a 504.
 */

import { Effect, Layer } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"
import * as Worker from "@mikepage/flareosaur/workers/worker"

// Wraps a handler with a time budget.
const withTimeout = <E, R>(handler: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>) =>
  handler.pipe(
    Effect.timeout("100 millis"),
    Effect.catchTag("TimeoutError", () =>
      Effect.succeed(HttpServerResponse.text("The upstream took too long", { status: 504 }))),
  )

const fast = Effect.succeed(HttpServerResponse.text("fast answer")).pipe(Effect.delay("10 millis"))
const slow = Effect.succeed(HttpServerResponse.text("slow answer")).pipe(Effect.delay("5 seconds"))

export default Worker.make({
  fetch: Layer.mergeAll(
    HttpRouter.add("GET", "/fast", withTimeout(fast)),
    HttpRouter.add("GET", "/slow", withTimeout(slow)),
  ),
})
