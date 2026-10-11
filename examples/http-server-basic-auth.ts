/**
 * @title HTTP server: basic authentication
 * @difficulty intermediate
 * @tags workers, http, security
 * @group HTTP
 * @bindings var:ADMIN_PASSWORD=correct-horse
 * @resource {https://developer.mozilla.org/en-US/docs/Web/HTTP/Authentication} MDN: HTTP authentication
 * @check GET /admin -> 401 header:www-authenticate~"Basic"
 * @check GET /admin h:authorization="Basic YWRtaW46d3Jvbmc=" -> 401
 * @check GET /admin h:authorization="Basic YWRtaW46Y29ycmVjdC1ob3JzZQ==" -> 200 "Hello, admin"
 *
 * Basic authentication sends a username and password with every request.
 * The password is a secret, so it comes from `Config.Redacted`, and the
 * comparison takes the same time whatever the input, so the response time
 * leaks nothing about the password.
 */

import { Config, Effect, Option, Redacted, Result, Schema } from "effect"
import { Base64 } from "effect/encoding"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import * as Worker from "@mikepage/flareosaur/workers/worker"

class Unauthorized extends Schema.TaggedError<Unauthorized>()("Unauthorized", {}) {}

// Compares two strings in time that depends only on their length.
const timingSafeEqual = (a: string, b: string): boolean => {
  const x = new TextEncoder().encode(a)
  const y = new TextEncoder().encode(b)
  let diff = x.length ^ y.length
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

// Decodes "Basic base64(user:password)" from the Authorization header.
const credentials = Effect.gen(function*() {
  const request = yield* HttpServerRequest.HttpServerRequest
  const header = Option.fromNullishOr(request.headers["authorization"])
  if (Option.isNone(header) || !header.value.startsWith("Basic ")) return yield* new Unauthorized()
  // Base64.decodeString returns a Result: a success or an EncodingError.
  const decoded = Base64.decodeString(header.value.slice(6))
  if (Result.isFailure(decoded)) return yield* new Unauthorized()
  const [user, ...rest] = decoded.success.split(":")
  return { user: user!, password: rest.join(":") }
})

const requireAdmin = Effect.gen(function*() {
  const expected = yield* Config.Redacted("ADMIN_PASSWORD")
  const { user, password } = yield* credentials
  if (user !== "admin" || !timingSafeEqual(password, Redacted.value(expected))) return yield* new Unauthorized()
  return user
})

const admin = requireAdmin.pipe(
  Effect.map((user) => HttpServerResponse.text(`Hello, ${user}`)),
  Effect.catchTag("Unauthorized", () =>
    Effect.succeed(HttpServerResponse.text("Unauthorized", {
      status: 401,
      headers: { "www-authenticate": `Basic realm="admin", charset="UTF-8"` },
    }))),
  Effect.orDie,
)

export default Worker.make({ fetch: HttpRouter.add("GET", "/admin", admin) })
