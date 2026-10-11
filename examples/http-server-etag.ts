/**
 * @title HTTP server: caching headers and ETags
 * @difficulty intermediate
 * @tags workers, http, cache
 * @group HTTP
 * @resource {https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching} MDN: HTTP caching
 * @check GET /report -> 200 "quarterly report" header:etag~"\"" header:cache-control~"max-age=60"
 * @check GET /report h:if-none-match="{{prev:etag}}" -> 304
 *
 * Cache headers let clients skip downloads they already have. An ETag is a
 * fingerprint of the response: the client sends it back in `If-None-Match`,
 * and if nothing changed the server answers `304 Not Modified` with no body.
 * `Cache-Control` says how long a copy may be reused without asking.
 */

import { Duration, Effect } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"
import * as CacheControl from "@mikepage/flareosaur/http/cache-control"
import * as ETag from "@mikepage/flareosaur/http/etag"
import * as Worker from "@mikepage/flareosaur/workers/worker"

const BODY = "The quarterly report: revenue up, costs down."

const report = Effect.gen(function*() {
  // A strong ETag from a SHA-256 of the body.
  const etag = yield* ETag.fromEntity(BODY)
  const response = yield* HttpServerResponse.text(BODY).pipe(
    CacheControl.set({ public: true, maxAge: Duration.minutes(1) }),
  )
  // Sets the ETag header, or answers 304 when If-None-Match matches.
  return yield* ETag.respond(response, etag)
}).pipe(Effect.orDie)

export default Worker.make({ fetch: HttpRouter.add("GET", "/report", report) })
