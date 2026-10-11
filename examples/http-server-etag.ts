/**
 * @title Caching headers and ETags
 * @difficulty intermediate
 * @tags workers, http, cache
 * @group HTTP
 * @resource {https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching} MDN: HTTP caching
 * @resource {https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/ETag} MDN: ETag
 * @resource {https://jsr.io/@std/http/doc/etag} @std/http: etag
 * @check GET /report -> 200 "quarterly report" header:etag~"\"" header:cache-control~"max-age=60"
 * @check GET /report h:if-none-match="{{prev:etag}}" -> 304
 * @check GET /report h:if-none-match="\"stale\"" -> 200 "quarterly report"
 *
 * Cache headers let clients skip downloads they already have. An ETag is a
 * fingerprint of the response: the client sends it back in `If-None-Match`,
 * and if nothing changed the server answers `304 Not Modified` with no body.
 * `Cache-Control` says how long a copy may be reused without asking.
 */

import { eTag, ifNoneMatch } from "@mikepage/flareosaur/http/etag";

const BODY = "The quarterly report: revenue up, costs down.";

async function report(request: Request): Promise<Response> {
  // eTag hashes the body (SHA-256 via crypto.subtle) into a strong ETag,
  // a quoted string such as "2d-...".
  const etag = await eTag(BODY);
  const headers = {
    etag,
    // Reuse for a minute without asking, from any cache.
    "cache-control": "public, max-age=60",
  };

  // ifNoneMatch is false when the client's copy is current. Then a 304
  // with the same headers and no body is enough.
  if (!ifNoneMatch(request.headers.get("if-none-match"), etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(BODY, {
    headers: { ...headers, "content-type": "text/plain; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (request.method === "GET" && pathname === "/report") {
      return await report(request);
    }
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler;
