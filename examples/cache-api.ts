/**
 * @title Cache API
 * @difficulty intermediate
 * @tags workers, cache, http
 * @group Cloudflare
 * @bindings outbound:echo
 * @resource {https://developers.cloudflare.com/workers/runtime-apis/cache/} Cloudflare: Cache API
 * @resource {https://developer.mozilla.org/en-US/docs/Web/API/Cache} MDN: Cache
 * @check GET /weather/amsterdam -> 200 "amsterdam" header:x-cache~"MISS"
 * @check GET /weather/amsterdam -> 200 "amsterdam" header:x-cache~"HIT"
 * @check GET /weather/paris -> 200 header:x-cache~"MISS"
 *
 * Deno implements the Web Cache API; Workers have it too, as `caches.default`,
 * a cache in each data center. Look the request up with `match`; on a miss,
 * build the response, return it, and store a copy with `ctx.waitUntil` so
 * the user never waits for the write. `Cache-Control: max-age` on the stored
 * response decides how long it stays.
 */

const weather = new URLPattern({ pathname: "/weather/:city" });

// The slow part: a call to an upstream weather API.
async function forecast(city: string): Promise<Response> {
  const upstream = await fetch(`https://weather.example.com/${city}`, {
    signal: AbortSignal.timeout(5_000),
  });
  const summary = upstream.ok ? "sunny" : "unknown";
  return new Response(`Forecast for ${city}: ${summary}`, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      // The cache keeps it for ten minutes.
      "cache-control": "public, max-age=600",
    },
  });
}

export default {
  async fetch(request, _env, ctx) {
    const city = weather.exec(request.url)?.pathname.groups.city;
    if (!city || request.method !== "GET") {
      return new Response("not found", { status: 404 });
    }

    // The cache key is the request: its URL, and the method, which must be GET.
    const cache = caches.default;
    const cached = await cache.match(request);
    if (cached) {
      // Cached responses are immutable; copy one to change its headers.
      const hit = new Response(cached.body, cached);
      hit.headers.set("x-cache", "HIT");
      return hit;
    }

    const response = await forecast(city);
    // A body can be read once: store a clone, return the original.
    ctx.waitUntil(cache.put(request, response.clone()));
    response.headers.set("x-cache", "MISS");
    return response;
  },
} satisfies ExportedHandler;
