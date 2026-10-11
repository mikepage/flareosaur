/**
 * @title HTTP server: cookies
 * @difficulty beginner
 * @tags workers, http
 * @group HTTP
 * @resource {https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies} MDN: HTTP cookies
 * @check GET /visit -> 200 "first visit" header:set-cookie~"visits=1"
 * @check GET /visit h:cookie=visits=4 -> 200 "visit number 5" header:set-cookie~"visits=5"
 * @check GET /logout -> 200 header:set-cookie~"Max-Age=0"
 *
 * Cookies carry state between requests. Read them from the request with a
 * Schema (so a tampered value is rejected), and set or expire them on the
 * response; Effect checks names, values and options when it serializes them.
 */

import { Effect, Layer, Option, Schema } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import * as Worker from "@mikepage/flareosaur/workers/worker"

const VisitCookies = Schema.Struct({ visits: Schema.optional(Schema.NumberFromString) })

const visit = Effect.gen(function*() {
  const cookies = yield* HttpServerRequest.schemaCookies(VisitCookies).pipe(
    Effect.orElseSucceed(() => ({ visits: undefined })),
  )
  const visits = Option.getOrElse(Option.fromNullishOr(cookies.visits), () => 0) + 1
  const body = visits === 1 ? "Welcome, first visit!" : `Welcome back, visit number ${visits}`
  return yield* HttpServerResponse.text(body).pipe(
    HttpServerResponse.setCookie("visits", String(visits), { httpOnly: true, path: "/", maxAge: "30 days" }),
  )
})

const logout = HttpServerResponse.text("Logged out").pipe(HttpServerResponse.expireCookie("visits", { path: "/" }))

export default Worker.make({
  fetch: Layer.mergeAll(HttpRouter.add("GET", "/visit", visit), HttpRouter.add("GET", "/logout", Effect.orDie(logout))),
})
