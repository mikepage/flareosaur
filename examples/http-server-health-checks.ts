/**
 * @title HTTP server: health checks
 * @difficulty beginner
 * @tags workers, http
 * @group HTTP
 * @bindings kv:CACHE
 * @resource {https://effect.website/docs/concurrency/basic-concurrency/} Effect: running effects concurrently
 * @check GET /healthz -> 200 "ok"
 * @check GET /readyz -> 200 "\"kv\":\"ok\"" "\"upstream\":\"ok\""
 *
 * A liveness endpoint answers as long as the Worker runs; a readiness
 * endpoint checks the dependencies. The checks run concurrently, each with a
 * timeout, and a failing check is reported instead of failing the endpoint.
 */

import { Effect, Layer } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"
import * as KeyValueStore from "effect/persistence/KeyValueStore"
import * as Kv from "@mikepage/flareosaur/workers/kv"
import * as Worker from "@mikepage/flareosaur/workers/worker"

// One check: "ok" if it succeeds within 500ms, otherwise the reason.
const check = <E, R>(effect: Effect.Effect<unknown, E, R>) =>
  effect.pipe(
    Effect.timeout("500 millis"),
    Effect.as("ok"),
    Effect.catchCause(() => Effect.succeed("failing")),
  )

const readiness = Effect.gen(function*() {
  const store = yield* KeyValueStore.KeyValueStore
  const results = yield* Effect.all({
    kv: check(store.set("health", String(Date.now()))),
    upstream: check(Effect.sleep("10 millis")),
  }, { concurrency: "unbounded" })
  const healthy = Object.values(results).every((r) => r === "ok")
  return HttpServerResponse.jsonUnsafe(results, { status: healthy ? 200 : 503 })
})

export default Worker.make({
  layer: Kv.layer("CACHE"),
  fetch: Layer.mergeAll(
    HttpRouter.add("GET", "/healthz", HttpServerResponse.text("ok")),
    HttpRouter.add("GET", "/readyz", readiness),
  ),
})
