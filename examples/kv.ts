/**
 * @title Workers KV: key/value storage
 * @difficulty beginner
 * @tags workers, kv, storage
 * @group Cloudflare runtime
 * @bindings kv:CACHE
 * @resource {https://developers.cloudflare.com/kv/} Cloudflare: Workers KV
 * @resource {https://effect.website/docs/platform/key-value-store/} Effect: KeyValueStore
 * @check PUT /prefs/ada h:content-type=application/json {"theme":"dark","fontSize":14} -> 200 "saved"
 * @check GET /prefs/ada -> 200 "\"theme\":\"dark\""
 * @check PUT /prefs/bob h:content-type=application/json {"theme":"neon"} -> 400
 * @check GET /prefs/carol -> 404
 * @check GET /visits -> 200 "visit 1"
 * @check GET /visits -> 200 "visit 2"
 *
 * Deno has Deno KV built in; a Worker gets Workers KV through a binding.
 * `Kv.layer` provides it as Effect's `KeyValueStore`, so a Schema-validated
 * store is one call away: values are checked when they are written and
 * when they are read back.
 */

import { Effect, Layer, Option, Schema } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import * as KeyValueStore from "effect/persistence/KeyValueStore"
import * as Kv from "@mikepage/flareosaur/workers/kv"
import * as Worker from "@mikepage/flareosaur/workers/worker"

const Preferences = Schema.Struct({
  theme: Schema.Literals(["light", "dark"]),
  fontSize: Schema.optional(Schema.Int),
})

// A typed view of the store: values are JSON-encoded Preferences, under a
// "prefs:" prefix.
const preferences = Effect.map(Effect.service(KeyValueStore.KeyValueStore), (store) =>
  KeyValueStore.toSchemaStore(KeyValueStore.prefix(store, "prefs:"), Preferences))

const routes = Layer.mergeAll(
  HttpRouter.add(
    "PUT",
    "/prefs/:user",
    Effect.gen(function*() {
      const { user } = yield* HttpRouter.params
      const prefs = yield* HttpServerRequest.schemaBodyJson(Preferences)
      yield* (yield* preferences).set(user!, prefs)
      return HttpServerResponse.text("saved")
    }).pipe(Effect.catchTag("SchemaError", () => Effect.succeed(HttpServerResponse.text("invalid", { status: 400 })))),
  ),
  HttpRouter.add(
    "GET",
    "/prefs/:user",
    Effect.gen(function*() {
      const { user } = yield* HttpRouter.params
      const prefs = yield* (yield* preferences).get(user!)
      return Option.match(prefs, {
        onNone: () => HttpServerResponse.text("not found", { status: 404 }),
        onSome: (p) => HttpServerResponse.jsonUnsafe(p),
      })
    }),
  ),
  // The untyped store works too, e.g. for a counter.
  HttpRouter.add(
    "GET",
    "/visits",
    Effect.gen(function*() {
      const store = yield* KeyValueStore.KeyValueStore
      const visits = Number((yield* store.get("visits")) ?? "0") + 1
      yield* store.set("visits", String(visits))
      return HttpServerResponse.text(`visit ${visits}`)
    }),
  ),
)

export default Worker.make({ layer: Kv.layer("CACHE"), fetch: routes })
