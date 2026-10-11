/**
 * @title CORS
 * @difficulty beginner
 * @tags workers, http
 * @group HTTP
 * @resource {https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS} MDN: CORS
 * @resource {https://developers.cloudflare.com/workers/examples/cors-header-proxy/} Workers: CORS header proxy
 * @check OPTIONS /api/data h:origin=https://app.example.com h:access-control-request-method=POST -> 204 header:access-control-allow-origin~"https://app.example.com" header:access-control-allow-methods~"POST"
 * @check GET /api/data h:origin=https://app.example.com -> 200 "ok" header:access-control-allow-origin~"https://app.example.com" header:vary~"Origin"
 *
 * Browsers block cross-origin requests unless the server opts in. Before a
 * request that is not "simple", the browser sends a preflight `OPTIONS`
 * request. The server answers it, and adds `Access-Control-Allow-Origin` to
 * the real response. No library needed: it is a few headers.
 */

const ALLOWED_ORIGINS = new Set(["https://app.example.com"]);
const ALLOWED_METHODS = "GET, POST";

// The CORS headers for a request, or none if its origin is not allowed.
function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return {};
  return { "access-control-allow-origin": origin };
}

function api(): Response {
  return Response.json({ status: "ok" });
}

export default {
  fetch(request: Request): Response {
    const { pathname } = new URL(request.url);
    if (!pathname.startsWith("/api/")) {
      return new Response("Not found", { status: 404 });
    }

    // A preflight asks: may I send this method with these headers? Answer
    // with what is allowed, and let the browser cache the answer for 10
    // minutes.
    if (
      request.method === "OPTIONS" &&
      request.headers.has("access-control-request-method")
    ) {
      return new Response(null, {
        status: 204,
        headers: {
          ...corsHeaders(request),
          "access-control-allow-methods": ALLOWED_METHODS,
          "access-control-allow-headers":
            request.headers.get("access-control-request-headers") ?? "",
          "access-control-max-age": "600",
          "vary": "Origin",
        },
      });
    }

    // For the real request, add the headers to the response. A Response you
    // build has mutable headers; one from fetch() needs a copy first:
    // `new Response(res.body, res)`. The answer depends on the Origin
    // header, so tell caches with Vary.
    const response = api();
    for (const [name, value] of Object.entries(corsHeaders(request))) {
      response.headers.set(name, value);
    }
    response.headers.append("vary", "Origin");
    return response;
  },
} satisfies ExportedHandler;
