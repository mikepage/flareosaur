/**
 * @title WebSockets
 * @difficulty intermediate
 * @tags workers, websockets
 * @group HTTP
 * @resource {https://developers.cloudflare.com/workers/runtime-apis/websockets/} Cloudflare: WebSockets
 * @resource {https://developer.mozilla.org/en-US/docs/Web/API/WebSocket} MDN: WebSocket
 * @check ws /echo send "ping" "hello" -> "echo: ping" "echo: hello"
 * @check GET /echo -> 426
 *
 * A Worker answers a WebSocket upgrade with one end of a `WebSocketPair`
 * and keeps the other. Event listeners on the kept end handle the
 * messages: here every message is echoed back. For state shared between
 * sockets, see the chat example with Durable Objects.
 */

export default {
  fetch(request: Request): Response {
    // A WebSocket handshake is a GET with an Upgrade header.
    if (request.headers.get("upgrade") !== "websocket") {
      return new Response("Expected a WebSocket upgrade", { status: 426 });
    }

    // The pair is two connected sockets. The client gets one, we keep the
    // other.
    const { 0: client, 1: server } = new WebSocketPair();

    // accept() tells the runtime this Worker handles the socket itself.
    // The listeners keep it alive as long as the connection is open.
    server.accept();
    server.addEventListener("message", (event) => {
      server.send(`echo: ${event.data}`);
    });
    server.addEventListener("close", (event) => {
      server.close(event.code, "bye");
    });

    // Status 101 switches protocols and hands the client end over.
    return new Response(null, { status: 101, webSocket: client });
  },
} satisfies ExportedHandler;
