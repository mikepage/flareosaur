/**
 * @title WebSocket chat with Durable Objects
 * @difficulty advanced
 * @tags workers, websockets, durable-objects
 * @group Cloudflare
 * @bindings do:ROOMS=ChatRoom
 * @resource {https://developers.cloudflare.com/durable-objects/best-practices/websockets/} Cloudflare: WebSocket hibernation
 * @resource {https://developer.mozilla.org/en-US/docs/Web/API/WebSocket} MDN: WebSocket
 * @check GET /rooms/lobby -> 426 "websocket"
 * @check ws /rooms/lobby send "hello everyone" -> "hello everyone"
 * @check GET /rooms/lobby/history -> 200 "hello everyone"
 * @check GET /rooms/kitchen/history -> 200 "[]"
 *
 * A chat room needs one place that knows every connected socket. Each room
 * is a Durable Object: the Worker forwards the WebSocket upgrade to the
 * room's object, which accepts the socket with the hibernation API. The
 * object can then be evicted from memory while sockets stay open; the
 * runtime wakes it up for `webSocketMessage`, and `getWebSockets` finds
 * every socket of the room to broadcast to. The last messages live in
 * storage, so new visitors can read the history.
 */

import { DurableObject } from "cloudflare:workers";

interface Env {
  ROOMS: DurableObjectNamespace<ChatRoom>;
}

export class ChatRoom extends DurableObject<Env> {
  // Called with the request the Worker forwarded.
  override async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname.endsWith("/history")) {
      return Response.json(await this.history());
    }

    // A WebSocketPair is two connected ends: one goes back to the client in
    // the 101 response, the other stays here.
    const { 0: client, 1: server } = new WebSocketPair();
    // acceptWebSocket, not server.accept(): the runtime holds the socket, so
    // the object may hibernate between messages. Nothing about a socket
    // should live in a field; it would be gone after hibernation.
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  // The runtime calls this for every message on any accepted socket.
  override async webSocketMessage(
    _ws: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    const text = typeof message === "string"
      ? message
      : new TextDecoder().decode(message);
    // Keep the last 50 messages.
    const messages = [...await this.history(), text].slice(-50);
    await this.ctx.storage.put("messages", messages);
    // Broadcast to every socket in the room, the sender included.
    for (const peer of this.ctx.getWebSockets()) peer.send(text);
  }

  override async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
  ): Promise<void> {
    // Complete the closing handshake.
    ws.close(code, reason);
  }

  private async history(): Promise<string[]> {
    return await this.ctx.storage.get<string[]>("messages") ?? [];
  }
}

const room = new URLPattern({ pathname: "/rooms/:room{/history}?" });

export default {
  async fetch(request, env) {
    const match = room.exec(request.url);
    if (!match) return new Response("not found", { status: 404 });
    const isHistory = request.url.endsWith("/history");
    if (
      !isHistory &&
      request.headers.get("upgrade")?.toLowerCase() !== "websocket"
    ) {
      return new Response("expected a websocket upgrade", { status: 426 });
    }
    // Every room name maps to one object; the request goes there as-is,
    // upgrade header included.
    const stub = env.ROOMS.getByName(match.pathname.groups.room!);
    return stub.fetch(request);
  },
} satisfies ExportedHandler<Env>;
