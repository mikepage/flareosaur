/**
 * @title Cache API
 * @difficulty intermediate
 * @tags workers, cache, http
 * @group Cloudflare
 * @bindings outbound:echo
 * @resource {https://developers.cloudflare.com/workers/runtime-apis/cache/} Cloudflare: Cache API
 * @check GET /weather/amsterdam -> 200 "amsterdam" header:x-cache~"MISS"
 * @check GET /weather/amsterdam -> 200 "amsterdam" header:x-cache~"HIT"
 * @check GET /weather/paris -> 200 header:x-cache~"MISS"
 *
 * Deno implements the Web Cache API; Workers have it too, as `caches.default`,
 * in front of every data center. `Cache.cached` serves a request from the
 * cache or runs the effect, returns its response and stores a copy in the
 * background with `ctx.waitUntil`, so the user never waits for the write.
 */

import { Effect } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import * as Cache from "@mikepage/flareosaur/workers/cache"
import * as Worker from "@mikepage/flareosaur/workers/worker"

// The slow part: a call to an upstream weather API.
const forecast = (city: string) =>
  Effect.gen(function*() {
    const client = yield* HttpClient.HttpClient
    const upstream = yield* client.get(`https://weather.example.com/${city}`)
    return new Response(`Forecast for ${city}: ${upstream.status === 200 ? "sunny" : "unknown"}`, {
      headers: { "content-type": "text/plain" },
    })
  }).pipe(Effect.provide(FetchHttpClient.layer), Effect.orDie)

export default Worker.make({
  fetch: (request) => {
    const city = new URL(request.url).pathname.split("/")[2] ?? "nowhere"
    // Cache each city's forecast for ten minutes.
    return Cache.cached(request, forecast(city), { maxAge: "10 minutes" })
  },
})
