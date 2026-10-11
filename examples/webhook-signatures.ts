/**
 * @title HTTP server: verifying webhook signatures
 * @difficulty intermediate
 * @tags workers, http, crypto, security
 * @group Cryptography
 * @bindings var:WEBHOOK_SECRET=whsec_test_secret
 * @resource {https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/verify} MDN: SubtleCrypto.verify
 * @check POST /webhooks h:x-signature=sha256=6a3d3c0e2f3c4c49f9b6dc17ab8ee0b0bbb0c92c8af1d0b6c3e3bd6b1a2e7c9d {"event":"paid"} -> 401 "bad signature"
 * @check POST /webhooks/selftest -> 200 "accepted: paid"
 *
 * Webhook senders sign each delivery with a shared secret so the receiver
 * can reject forgeries. Verify the HMAC of the raw body before parsing it,
 * with a constant-time comparison, and keep the secret in `Config.Redacted`.
 */

import { Config, Effect, Layer, Schema } from "effect"
import { Hex } from "effect/encoding"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { hmacSign, hmacVerify } from "@mikepage/flareosaur/crypto"
import * as Worker from "@mikepage/flareosaur/workers/worker"

class BadSignature extends Schema.TaggedError<BadSignature>()("BadSignature", {}) {}

const Event = Schema.Struct({ event: Schema.String })

// Verifies "x-signature: sha256=<hex>" against the raw body, then decodes it.
const verified = (body: string, header: string | undefined) =>
  Effect.gen(function*() {
    const secret = yield* Config.Redacted("WEBHOOK_SECRET")
    const signature = Hex.decode(header?.replace(/^sha256=/, "") ?? "")
    if (signature._tag === "Failure") return yield* new BadSignature()
    // hmacVerify compares in constant time.
    const ok = yield* hmacVerify(secret, body, signature.success, { hash: "SHA-256" })
    if (!ok) return yield* new BadSignature()
    return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Event))(body)
  })

const receive = Effect.gen(function*() {
  const request = yield* HttpServerRequest.HttpServerRequest
  const body = yield* request.text
  const event = yield* verified(body, request.headers["x-signature"])
  return HttpServerResponse.text(`accepted: ${event.event}`)
}).pipe(
  Effect.catchTag("BadSignature", () => Effect.succeed(HttpServerResponse.text("bad signature", { status: 401 }))),
)

// The sender's side, to show a signature that verifies: sign a body with the
// same secret and deliver it to ourselves.
const selftest = Effect.gen(function*() {
  const secret = yield* Config.Redacted("WEBHOOK_SECRET")
  const body = JSON.stringify({ event: "paid" })
  const signature = `sha256=${Hex.encode(yield* hmacSign(secret, body, { hash: "SHA-256" }))}`
  const event = yield* verified(body, signature)
  return HttpServerResponse.text(`accepted: ${event.event}`)
})

export default Worker.make({
  fetch: Layer.mergeAll(
    HttpRouter.add("POST", "/webhooks", Effect.orDie(receive)),
    HttpRouter.add("POST", "/webhooks/selftest", Effect.orDie(selftest)),
  ),
})
