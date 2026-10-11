/**
 * @title WebSockets
 * @difficulty intermediate
 * @tags workers, websockets
 * @group HTTP
 * @resource {https://developers.cloudflare.com/workers/runtime-apis/websockets/} Cloudflare: WebSockets
 * @check ws /echo send "ping" "hello" -> "echo: ping" "echo: hello"
 * @check GET /echo -> 426
 *
 * A Worker answers a WebSocket upgrade with one end of a `WebSocketPair` and
 * keeps the other. Turning the socket's messages into an Effect `Stream`
 * makes the handler a pipeline: here every message is echoed back. For
 * state shared between sockets, see the chat example with Durable Objects.
 */

import { Effect, Queue, Stream } from "effect"
import * as Worker from "@mikepage/flareosaur/workers/worker"

// The messages of a socket as a Stream that ends when the socket closes.
const messages = (socket: WebSocket) =>
  Stream.callback<string>((queue) =>
    Effect.sync(() => {
      socket.addEventListener("message", (event) => Queue.offerUnsafe(queue, String(event.data)))
      socket.addEventListener("close", () => Queue.endUnsafe(queue))
    })
  )

export default Worker.make({
  fetch: (request) =>
    Effect.gen(function*() {
      if (request.headers.get("upgrade") !== "websocket") {
        return new Response("Expected a WebSocket upgrade", { status: 426 })
      }
      const pair = new WebSocketPair()
      const server = pair[1]
      server.accept()
      // Handle the socket after the response is returned.
      yield* Worker.waitUntil(
        messages(server).pipe(Stream.runForEach((message) => Effect.sync(() => server.send(`echo: ${message}`)))),
      )
      return new Response(null, { status: 101, webSocket: pair[0] })
    }),
})
