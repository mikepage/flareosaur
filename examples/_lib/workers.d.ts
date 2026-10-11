// Workers runtime globals the web platform types do not have.
declare const WebSocketPair: { new(): { 0: WebSocket; 1: WebSocket } }
interface ResponseInit {
  webSocket?: WebSocket | null
}
interface WebSocket {
  accept(): void
  serializeAttachment(value: unknown): void
  deserializeAttachment(): unknown
}
