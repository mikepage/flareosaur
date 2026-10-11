/**
 * @title WebSocket chat with Durable Objects
 * @difficulty advanced
 * @tags workers, websockets, durable-objects
 * @group Cloudflare runtime
 * @bindings do:ROOMS=ChatRoom
 * @resource {https://developers.cloudflare.com/durable-objects/best-practices/websockets/} Cloudflare: WebSocket hibernation
 * @check ws /rooms/lobby send "hello everyone" -> "hello everyone"
 * @check GET /rooms/lobby/history -> 200 "hello everyone"
 *
 * A chat room needs one place that knows every connected socket. Each room
 * is a Durable Object: the Worker forwards the WebSocket upgrade to the
 * room's object, which accepts the socket with the hibernation API and
 * broadcasts every message to the sockets of that room. The room keeps its
 * last messages in storage, so new visitors can read the history.
 */

import { Effect, Schema } from "effect"
import * as KeyValueStore from "effect/persistence/KeyValueStore"
import * as DurableObject from "@mikepage/flareosaur/workers/durable-object"
import * as Worker from "@mikepage/flareosaur/workers/worker"

const History = Schema.Array(Schema.String)

export class ChatRoom {
  private readonly runner: DurableObject.Runner<never>

  constructor(private readonly state: DurableObject.DurableObjectStateLike, env: Record<string, unknown>) {
    this.runner = DurableObject.makeRunner(state, env)
  }

  // History in storage, decoded with a Schema.
  private readonly history = Effect.map(Effect.service(KeyValueStore.KeyValueStore), (store) =>
    KeyValueStore.toSchemaStore(store, History))

  async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname.endsWith("/history")) {
      const history = this.history
      return this.runner.run(Effect.gen(function*() {
        const messages = yield* (yield* history).get("messages")
        return Response.json(messages._tag === "Some" ? messages.value : [])
      }))
    }
    // Accept the socket with the hibernation API: the object can sleep while
    // sockets stay connected, and wakes up for webSocketMessage.
    const pair = new WebSocketPair()
    this.state.acceptWebSocket!(pair[1])
    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  async webSocketMessage(_ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const text = typeof message === "string" ? message : new TextDecoder().decode(message)
    const state = this.state
    const history = this.history
    await this.runner.run(Effect.gen(function*() {
      // Keep the last 50 messages.
      const store = yield* history
      const previous = yield* store.get("messages")
      const messages = [...(previous._tag === "Some" ? previous.value : []), text].slice(-50)
      yield* store.set("messages", messages)
      // Broadcast to every socket in the room, including the sender.
      for (const peer of state.getWebSockets!()) peer.send(text)
    }))
  }
}

// The Worker routes /rooms/:room (and its history) to the room's object.
export default Worker.make({
  fetch: (request) =>
    Effect.gen(function*() {
      const match = new URL(request.url).pathname.match(/^\/rooms\/([^/]+)/)
      if (!match) return new Response("not found", { status: 404 })
      const stub = yield* DurableObject.stub("ROOMS", match[1]!)
      return yield* Effect.promise(() => stub.fetch(request))
    }),
})

