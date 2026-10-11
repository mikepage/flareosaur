/**
 * @title HTTP server: sessions with signed cookies
 * @difficulty intermediate
 * @tags workers, http, security
 * @group HTTP
 * @bindings var:COOKIE_SECRET=change-me-to-a-long-random-string
 * @resource {https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies} MDN: HTTP cookies
 * @check GET /me -> 401 "not logged in"
 * @check POST /login/ada -> 200 header:set-cookie~"session=ada."
 * @check GET /me h:cookie=session=ada.forged -> 401
 *
 * A session cookie must not be editable by the client, or anyone could
 * claim to be anyone. A signed cookie carries an HMAC of its value: the
 * server verifies it on every request and treats a tampered cookie as no
 * cookie at all. The signing key comes from a secret, through `Config`.
 */

import { Config, Effect, Layer, Option } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"
import * as SignedCookie from "@mikepage/flareosaur/http/signed-cookie"
import * as Worker from "@mikepage/flareosaur/workers/worker"

// The signer service, keyed by the COOKIE_SECRET secret.
const Signer = Layer.unwrap(Effect.map(Config.Redacted("COOKIE_SECRET"), (secret) => SignedCookie.layer(secret)))

const login = Effect.gen(function*() {
  const { user } = yield* HttpRouter.params
  return yield* HttpServerResponse.text(`logged in as ${user}`).pipe(
    SignedCookie.setCookie("session", user!, { httpOnly: true, secure: true, sameSite: "lax", path: "/" }),
  )
})

const me = Effect.gen(function*() {
  // None when the cookie is missing or its signature does not verify.
  const user = yield* SignedCookie.getCookie("session")
  return Option.match(user, {
    onNone: () => HttpServerResponse.text("not logged in", { status: 401 }),
    onSome: (name) => HttpServerResponse.text(`hello, ${name}`),
  })
})

export default Worker.make({
  layer: Signer,
  fetch: Layer.mergeAll(
    HttpRouter.add("POST", "/login/:user", Effect.orDie(login)),
    HttpRouter.add("GET", "/me", Effect.orDie(me)),
  ),
})
