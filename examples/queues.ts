/**
 * @title Queues: offload work
 * @difficulty intermediate
 * @tags workers, queues
 * @group Cloudflare
 * @bindings queue:EMAILS, kv:LOG
 * @resource {https://developers.cloudflare.com/queues/} Cloudflare: Queues
 * @check POST /signup h:content-type=application/json {"email":"ada@example.com"} -> 202 "queued"
 * @check queue EMAILS {"to":"ada@example.com","template":"welcome"}
 * @check queue EMAILS {"nonsense":true}
 * @check GET /sent -> 200 "welcome email to ada@example.com" !"nonsense"
 *
 * Deno Queues let an app hand work to a background listener. On Workers the
 * same thing is a Queue with a producer binding and a `queue` handler. With
 * `Queue.Producer` and `Queue.consume`, messages are Schema-typed on both
 * ends: a message that does not decode is logged and dropped instead of
 * crashing the consumer or retrying forever.
 */

import { Effect, Layer, Schema } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import * as KeyValueStore from "effect/persistence/KeyValueStore"
import * as Kv from "@mikepage/flareosaur/workers/kv"
import * as Queue from "@mikepage/flareosaur/workers/queue"
import * as Worker from "@mikepage/flareosaur/workers/worker"

// The message type, shared by producer and consumer.
const Email = Schema.Struct({ to: Schema.String, template: Schema.Literals(["welcome", "reset"]) })
const Emails = Queue.Producer.of<typeof Email>("Emails")

// The producer side: the request handler queues an email and answers at once.
const signup = Effect.gen(function*() {
  const { email } = yield* HttpServerRequest.schemaBodyJson(Schema.Struct({ email: Schema.String }))
  const emails = yield* Emails
  yield* emails.send({ to: email, template: "welcome" })
  return HttpServerResponse.text("queued", { status: 202 })
})

// The consumer side: one handler per decoded message. Here "sending" an email
// appends a line to KV so the example can show what happened.
const sendEmail = (email: typeof Email.Type) =>
  Effect.gen(function*() {
    const store = yield* KeyValueStore.KeyValueStore
    const log = (yield* store.get("sent")) ?? ""
    yield* store.set("sent", `${log}${email.template} email to ${email.to}\n`)
  })

const sent = Effect.gen(function*() {
  const store = yield* KeyValueStore.KeyValueStore
  return HttpServerResponse.text((yield* store.get("sent")) ?? "")
})

export default Worker.make({
  layer: Layer.merge(Queue.layer(Emails, "EMAILS", Email), Kv.layer("LOG")),
  fetch: Layer.mergeAll(HttpRouter.add("POST", "/signup", signup), HttpRouter.add("GET", "/sent", sent)),
  queue: Queue.consume(Email, sendEmail),
})
