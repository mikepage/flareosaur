// The parts of the Workers TCP sockets API (`cloudflare:sockets`) the SMTP
// submission example uses. The module is provided by the runtime and left
// external in the bundle.
declare module "cloudflare:sockets" {
  interface SocketAddress {
    hostname: string
    port: number
  }
  interface SocketOptions {
    secureTransport?: "off" | "on" | "starttls"
    allowHalfOpen?: boolean
  }
  interface TlsOptions {
    expectedServerHostname?: string
  }
  interface Socket {
    readonly readable: ReadableStream<Uint8Array>
    readonly writable: WritableStream<Uint8Array>
    readonly opened: Promise<unknown>
    readonly closed: Promise<void>
    close(): Promise<void>
    startTls(options?: TlsOptions): Socket
  }
  export function connect(address: SocketAddress | string, options?: SocketOptions): Socket
}
