/**
 * @title Durable Objects: a consistent counter
 * @difficulty intermediate
 * @tags workers, durable-objects
 * @group Cloudflare runtime
 * @bindings do:COUNTERS=Counter
 * @resource {https://developers.cloudflare.com/durable-objects/} Cloudflare: Durable Objects
 * @check POST /counters/likes -> 200 "likes: 1"
 * @check POST /counters/likes -> 200 "likes: 2"
 * @check POST /counters/views -> 200 "views: 1"
 * @check GET /counters/likes -> 200 "likes: 2"
 *
 * A Durable Object is a single instance with its own storage: every request
 * for the same name reaches the same object, one at a time, so a counter
 * never loses an update. `DurableObject.makeRunner` runs Effects inside the
 * object with its storage as Effect's `KeyValueStore`.
 */

import { Effect } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"
import * as KeyValueStore from "effect/persistence/KeyValueStore"
import * as DurableObject from "@mikepage/flareosaur/workers/durable-object"
import * as Worker from "@mikepage/flareosaur/workers/worker"

// The Durable Object class. The runtime creates one instance per name.
export class Counter {
  private readonly runner: DurableObject.Runner<never>

  constructor(state: DurableObject.DurableObjectStateLike, env: Record<string, unknown>) {
    this.runner = DurableObject.makeRunner(state, env)
  }

  fetch(request: Request): Promise<Response> {
    return this.runner.run(Effect.gen(function*() {
      const store = yield* KeyValueStore.KeyValueStore
      let count = Number((yield* store.get("count")) ?? "0")
      if (request.method === "POST") {
        count++
        yield* store.set("count", String(count))
      }
      return new Response(String(count))
    }))
  }
}

// The Worker forwards each counter to the object of the same name.
const counter = (request: { method: string; url: string }) =>
  Effect.gen(function*() {
    const { name } = yield* HttpRouter.params
    const stub = yield* DurableObject.stub("COUNTERS", name!)
    const response = yield* Effect.promise(() => stub.fetch(new Request(`http://do/${name}`, { method: request.method })))
    const count = yield* Effect.promise(() => response.text())
    return HttpServerResponse.text(`${name}: ${count}`)
  })

export default Worker.make({
  fetch: HttpRouter.add("*", "/counters/:name", counter),
})
