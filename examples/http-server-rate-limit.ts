/**
 * @title HTTP server: rate limiting
 * @difficulty advanced
 * @tags workers, http, durable-objects
 * @group HTTP
 * @bindings do:LIMITERS=Limiter
 * @resource {https://developers.cloudflare.com/durable-objects/} Cloudflare: Durable Objects
 * @check GET /api h:cf-connecting-ip=203.0.113.7 -> 200 "2 requests left"
 * @check GET /api h:cf-connecting-ip=203.0.113.7 -> 200 "1 requests left"
 * @check GET /api h:cf-connecting-ip=203.0.113.7 -> 200 "0 requests left"
 * @check GET /api h:cf-connecting-ip=203.0.113.7 -> 429 header:retry-after~""
 * @check GET /api h:cf-connecting-ip=198.51.100.1 -> 200 "2 requests left"
 *
 * A rate limiter protects a server from clients that send too many
 * requests. A Worker runs in many isolates at once, so in-memory counters
 * would each see only part of the traffic. Give every client its own
 * Durable Object instead: one instance per IP address sees all of that
 * client's requests, and runs Effect's `RateLimiter` with an in-memory store.
 */

import { Duration, Effect, Layer } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import * as RateLimiter from "effect/persistence/RateLimiter"
import * as DurableObject from "@mikepage/flareosaur/workers/durable-object"
import * as Worker from "@mikepage/flareosaur/workers/worker"

// One Limiter object per client. Its RateLimiter keeps counts in memory,
// which is enough because the object is the only place this client's
// requests are counted.
export class Limiter {
  private readonly runner: DurableObject.Runner<RateLimiter.RateLimiter>

  constructor(state: DurableObject.DurableObjectStateLike, env: Record<string, unknown>) {
    this.runner = DurableObject.makeRunner(state, env, RateLimiter.layer.pipe(Layer.provide(RateLimiter.layerStoreMemory)))
  }

  fetch(request: Request): Promise<Response> {
    const key = new URL(request.url).pathname
    return this.runner.run(Effect.gen(function*() {
      const limiter = yield* RateLimiter.RateLimiter
      // 3 requests per minute, fixed window; fail instead of waiting.
      const result = yield* limiter.consume({ key, limit: 3, window: "1 minute", onExceeded: "fail" })
      return Response.json({ remaining: result.remaining })
    }).pipe(
      Effect.catchTag("RateLimiterError", (error) =>
        Effect.succeed(Response.json(
          { retryAfter: error.reason._tag === "RateLimitExceeded" ? Duration.toSeconds(error.reason.retryAfter) : 60 },
          { status: 429 },
        ))),
    ))
  }
}

const api = Effect.gen(function*() {
  const request = yield* HttpServerRequest.HttpServerRequest
  const ip = request.headers["cf-connecting-ip"] ?? "unknown"
  const stub = yield* DurableObject.stub("LIMITERS", ip)
  const response = yield* Effect.promise(() => stub.fetch(`http://limiter/${ip}`))
  const body = (yield* Effect.promise(() => response.json())) as { remaining?: number; retryAfter?: number }
  if (response.status === 429) {
    return HttpServerResponse.text("Too many requests", {
      status: 429,
      headers: { "retry-after": String(Math.ceil(body.retryAfter ?? 60)) },
    })
  }
  return HttpServerResponse.text(`ok, ${body.remaining} requests left this minute`)
})

export default Worker.make({ fetch: HttpRouter.add("GET", "/api", api) })
