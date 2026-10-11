/**
 * @title Rate limiting
 * @difficulty intermediate
 * @tags workers, http, rate-limiting
 * @group HTTP
 * @bindings ratelimit:LIMITER=3/60
 * @resource {https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/} Cloudflare: rate limiting binding
 * @resource {https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/429} MDN: 429 Too Many Requests
 * @check GET /api h:cf-connecting-ip=203.0.113.7 -> 200 "ok"
 * @check GET /api h:cf-connecting-ip=203.0.113.7 -> 200 "ok"
 * @check GET /api h:cf-connecting-ip=203.0.113.7 -> 200 "ok"
 * @check GET /api h:cf-connecting-ip=203.0.113.7 -> 429 "Too many requests" header:retry-after~"60"
 * @check GET /api h:cf-connecting-ip=198.51.100.1 -> 200 "ok"
 *
 * A rate limiter protects a server from clients that send too many
 * requests. A Worker runs in many isolates at once, so in-memory counters
 * would each see only part of the traffic. The rate limiting binding keeps
 * the counts for you: configure a limit and a period in wrangler, then ask
 * it about a key on every request.
 */

interface Env {
  // In wrangler.jsonc: "ratelimits": [{ "name": "LIMITER",
  // "namespace_id": "1001", "simple": { "limit": 3, "period": 60 } }]
  LIMITER: RateLimit;
}

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname !== "/api") {
      return new Response("Not Found", { status: 404 });
    }

    // Count per client. cf-connecting-ip is the visitor's address; a user
    // or API key id makes a better key when you have one.
    const key = request.headers.get("cf-connecting-ip") ?? "unknown";

    // limit() counts this request and says whether the key is still within
    // 3 requests per 60 seconds. The counts are local to each Cloudflare
    // location and eventually consistent, which suits abuse protection.
    const { success } = await env.LIMITER.limit({ key });
    if (!success) {
      return new Response("Too many requests", {
        status: 429,
        headers: { "retry-after": "60" },
      });
    }
    return new Response(`ok, ${key} is within its limit`);
  },
} satisfies ExportedHandler<Env>;
