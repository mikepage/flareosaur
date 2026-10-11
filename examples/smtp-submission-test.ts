/**
 * @title SMTP submission test
 * @difficulty advanced
 * @tags workers, sockets, tcp, tls, email
 * @group Email
 * @resource {https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/} Cloudflare: TCP sockets
 * @resource {https://www.rfc-editor.org/rfc/rfc8314} RFC 8314: TLS for email submission
 * @resource {https://effect.website/docs/resource-management/scope/} Effect: Scope
 * @check GET / -> 200 "smtp-submission-test" "/api?host="
 * @check GET /api?host=smtp.gmail.com&port=587 -> 200 "\"success\":true" "\"protocol\":\"starttls\"" "\"tlsUpgraded\":true" "\"plaintextCapabilities\"" "AUTH" "STARTTLS"
 * @check GET /api?host=smtp.gmail.com&port=465 -> 200 "\"success\":true" "\"protocol\":\"implicit-tls\"" "\"tlsUpgraded\":true" "AUTH"
 * @check GET /api -> 400 "\"error\""
 * @check GET /api?host=notahost -> 400 "invalid hostname"
 * @check GET /api?host=smtp.gmail.com&port=25 -> 400 "port must be 587, 465, or 2525"
 * @check GET /api?host=10.0.0.1 -> 400 "IP addresses are not accepted"
 * @check GET /api?host=localtest.me -> 400 "private or reserved address"
 * @check GET /api?host=no-such-host.invalid -> 400 "does not resolve"
 *
 * Tests a mail server's submission port over raw TCP: reads the banner,
 * sends EHLO, upgrades with STARTTLS when offered (implicit TLS on 465),
 * sends EHLO again and returns the capabilities plus the full transcript.
 * The socket from `cloudflare:sockets` is an Effect resource
 * (`acquireRelease`), every read has a timeout, and protocol failures are
 * typed errors; the host is checked over DNS-over-HTTPS with `HttpClient`
 * so only public addresses are dialled.
 */

import { connect, type Socket } from "cloudflare:sockets"
import { Clock, Duration, Effect, Layer, Schema, SchemaIssue, SchemaTransformation } from "effect"
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http"
import * as Worker from "@mikepage/flareosaur/workers/worker"

const PORTS = [587, 465, 2525] as const
const TIMEOUT = Duration.seconds(8)
const EHLO_NAME = "tools.mikepage.nl"

// --- Input -----------------------------------------------------------------

const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i
const isDomain = (input: string) => {
  if (input.length > 253) return false
  const labels = input.replace(/\.$/, "").split(".")
  return labels.length >= 2 && labels.every((l) => LABEL.test(l))
}

// `host` is trimmed, lowercased and must look like a hostname; IP literals
// are refused, since a literal skips the DNS policy below. Port 25 is not
// on the list: Workers cannot open it.
const Query = Schema.Struct({
  host: Schema.Trim.pipe(
    Schema.decodeTo(Schema.String, SchemaTransformation.toLowerCase()),
  ).check(
    Schema.makeFilter((host: string) =>
      /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":")
        ? "IP addresses are not accepted, enter a hostname"
        : isDomain(host) || "invalid hostname"
    ),
  ),
  port: Schema.optional(
    Schema.FiniteFromString.check(
      Schema.makeFilter((p: number) => (PORTS as ReadonlyArray<number>).includes(p) || "port must be 587, 465, or 2525"),
    ),
  ),
})

// --- Errors ----------------------------------------------------------------

/** The host resolves to a private or reserved address, or to nothing. */
class HostNotAllowedError extends Schema.TaggedError<HostNotAllowedError>()("HostNotAllowedError", {
  message: Schema.String,
}) {}

/** The DNS-over-HTTPS lookup failed. */
class DnsError extends Schema.TaggedError<DnsError>()("DnsError", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

/** Something went wrong on the SMTP connection. */
class SmtpError extends Schema.TaggedError<SmtpError>()("SmtpError", {
  message: Schema.String,
}) {}

// --- SSRF guard ------------------------------------------------------------
// Resolve A and AAAA over DoH and refuse private, loopback, link-local and
// reserved ranges. Resolving right before connecting narrows the window for
// DNS rebinding.

const DohResponse = Schema.Struct({
  Status: Schema.Number,
  Answer: Schema.optional(Schema.Array(Schema.Struct({ type: Schema.Number, data: Schema.String }))),
})

const isPrivateIPv4 = (ip: string): boolean => {
  const p = ip.split(".").map(Number)
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true
  const [a = 0, b = 0] = p
  return a === 0 || a === 10 || a === 127 || // this-host, private, loopback
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) || // private
    a >= 224 // multicast / reserved
}

const isPrivateIPv6 = (ip: string): boolean => {
  const h = ip.toLowerCase()
  if (h === "::1" || h === "::") return true
  if (/^fe[89ab]/.test(h)) return true // fe80::/10
  if (h.startsWith("fc") || h.startsWith("fd")) return true // fc00::/7
  const mapped = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/) // IPv4-mapped
  return mapped ? isPrivateIPv4(mapped[1]!) : false
}

const resolve = (host: string, type: "A" | "AAAA") =>
  Effect.gen(function*() {
    const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)
    const res = yield* client.execute(
      HttpClientRequest.get("https://cloudflare-dns.com/dns-query", {
        urlParams: { name: host, type },
        acceptJson: false,
        headers: { accept: "application/dns-json" },
      }),
    )
    const body = yield* HttpClientResponse.schemaBodyJson(DohResponse)(res)
    const want = type === "A" ? 1 : 28
    return (body.Answer ?? []).filter((r) => r.type === want).map((r) => r.data)
  }).pipe(
    Effect.timeout(TIMEOUT),
    Effect.mapError((cause) => new DnsError({ message: `Could not resolve ${host}`, cause })),
  )

const assertPublicHost = Effect.fnUntraced(function*(host: string) {
  const [a, aaaa] = yield* Effect.all([resolve(host, "A"), resolve(host, "AAAA")], { concurrency: 2 })
  const addresses = [...a, ...aaaa]
  if (addresses.length === 0) {
    return yield* new HostNotAllowedError({ message: "That hostname does not resolve to any address." })
  }
  if (addresses.some((ip) => ip.includes(":") ? isPrivateIPv6(ip) : isPrivateIPv4(ip))) {
    return yield* new HostNotAllowedError({ message: "That hostname resolves to a private or reserved address." })
  }
})

// --- The SMTP session ------------------------------------------------------

interface LogEntry {
  /** ms since the probe started */
  t: number
  direction: "sent" | "received" | "info" | "error"
  message: string
}

interface SmtpProbe {
  success: boolean
  host: string
  port: number
  protocol: "implicit-tls" | "starttls"
  greeting?: string
  /** EHLO capabilities, after the TLS upgrade when there was one */
  capabilities: Array<string>
  /** EHLO capabilities before STARTTLS (only when an upgrade happened) */
  plaintextCapabilities?: Array<string>
  tlsUpgraded: boolean
  error?: string
  logs: Array<LogEntry>
}

type Log = (direction: LogEntry["direction"], message: string) => Effect.Effect<void>

// Runs `effect` with the probe's timeout; a timeout is an SmtpError too.
const timed = <A, E>(effect: Effect.Effect<A, E>, what: string) =>
  Effect.timeoutOrElse(effect, {
    duration: TIMEOUT,
    orElse: () => Effect.fail(new SmtpError({ message: `${what} timed out after ${Duration.toMillis(TIMEOUT)}ms` })),
  })

const awaitOpened = (socket: Socket, what: string) =>
  timed(
    Effect.tryPromise({
      try: () => socket.opened,
      catch: (e) => new SmtpError({ message: `${what} failed: ${e instanceof Error ? e.message : String(e)}` }),
    }),
    what,
  )

// A line-oriented SMTP session over one socket (one per TLS layer), logging
// every line both ways.
const session = (socket: Socket, log: Log) => {
  const reader = socket.readable.getReader()
  const writer = socket.writable.getWriter()
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buf = ""

  // Reads reply lines until the final "NNN " line (a space, not a dash).
  const read = (what: string) =>
    timed(
      Effect.gen(function*() {
        const lines: Array<string> = []
        while (true) {
          let i: number
          while ((i = buf.indexOf("\r\n")) !== -1) {
            const line = buf.slice(0, i)
            buf = buf.slice(i + 2)
            lines.push(line)
            yield* log("received", line)
            if (/^\d{3}( |$)/.test(line)) return lines
          }
          const { value, done } = yield* Effect.tryPromise({
            try: () => reader.read(),
            catch: (e) => new SmtpError({ message: `read failed: ${e instanceof Error ? e.message : String(e)}` }),
          })
          if (done) return yield* new SmtpError({ message: `connection closed while waiting for ${what}` })
          buf += decoder.decode(value, { stream: true })
        }
      }),
      what,
    )

  const send = (line: string) =>
    log("sent", line).pipe(
      Effect.andThen(Effect.tryPromise({
        try: () => writer.write(encoder.encode(`${line}\r\n`)),
        catch: (e) => new SmtpError({ message: `write failed: ${e instanceof Error ? e.message : String(e)}` }),
      })),
    )

  // Hands the socket back, e.g. before startTls() takes it over.
  const release = Effect.sync(() => {
    reader.releaseLock()
    writer.releaseLock()
  })

  return { read, send, release }
}

// The first line is "250-hostname greeting"; the rest are capabilities.
const capabilitiesOf = (lines: ReadonlyArray<string>) =>
  lines.slice(1).filter((l) => l.startsWith("250")).map((l) => l.slice(4).trim()).filter(Boolean)

const probe = Effect.fnUntraced(function*(host: string, port: number) {
  const started = yield* Clock.currentTimeMillis
  const logs: Array<LogEntry> = []
  const log: Log = (direction, message) =>
    Effect.map(Clock.currentTimeMillis, (now) => {
      logs.push({ t: now - started, direction, message })
    })
  const implicit = port === 465
  const result: SmtpProbe = {
    success: false,
    host,
    port,
    protocol: implicit ? "implicit-tls" : "starttls",
    capabilities: [],
    tlsUpgraded: implicit,
    logs,
  }

  const conversation = Effect.gen(function*() {
    yield* log("info", `Connecting to ${host}:${port}${implicit ? " with implicit TLS" : ""}...`)
    // The socket is a resource: whatever happens below (a failure, a
    // timeout, an interruption), the scope closes it. `current` follows the
    // STARTTLS upgrade, which replaces the socket.
    const conn = yield* Effect.acquireRelease(
      Effect.sync(() => ({
        current: connect({ hostname: host, port }, {
          secureTransport: implicit ? "on" : "starttls",
          allowHalfOpen: false,
        }),
      })),
      (conn) => Effect.promise(() => conn.current.close().catch(() => {})),
    )
    yield* awaitOpened(conn.current, "TCP connect")
    yield* log("info", implicit ? "TCP connection established, TLS handshake done" : "TCP connection established")
    let s = session(conn.current, log)

    result.greeting = (yield* s.read("greeting")).join("\n")
    yield* s.send(`EHLO ${EHLO_NAME}`)
    result.capabilities = capabilitiesOf(yield* s.read("EHLO reply"))

    if (!implicit && result.capabilities.some((c) => c.toUpperCase() === "STARTTLS")) {
      yield* s.send("STARTTLS")
      const [reply = ""] = yield* s.read("STARTTLS reply")
      if (!reply.startsWith("220")) return yield* new SmtpError({ message: `STARTTLS rejected: ${reply}` })
      yield* log("info", "Upgrading to TLS...")
      yield* s.release
      conn.current = conn.current.startTls({ expectedServerHostname: host })
      yield* awaitOpened(conn.current, "TLS handshake")
      yield* log("info", "TLS handshake successful")
      s = session(conn.current, log)
      result.tlsUpgraded = true
      result.plaintextCapabilities = result.capabilities
      // Servers may advertise different capabilities (typically AUTH) once TLS is up.
      yield* s.send(`EHLO ${EHLO_NAME}`)
      result.capabilities = capabilitiesOf(yield* s.read("EHLO reply after TLS"))
    }

    yield* s.send("QUIT")
    yield* Effect.ignore(s.read("QUIT reply"))
    result.success = true
  }).pipe(Effect.scoped)

  // A failed probe is still a result: the transcript shows where it broke.
  yield* conversation.pipe(
    Effect.catchTag("SmtpError", (error) => {
      result.error = error.message
      return log("error", error.message)
    }),
  )
  return result
})

// --- Routes ----------------------------------------------------------------

const api = Effect.gen(function*() {
  const { host, port = 587 } = yield* HttpServerRequest.schemaSearchParams(Query)
  yield* assertPublicHost(host)
  return HttpServerResponse.jsonUnsafe(yield* probe(host, port))
}).pipe(
  Effect.catchTags({
    SchemaError: (error) =>
      Effect.succeed(
        HttpServerResponse.jsonUnsafe({ error: SchemaIssue.makeFormatterDefault()(error.issue) }, { status: 400 }),
      ),
    HostNotAllowedError: (error) =>
      Effect.succeed(HttpServerResponse.jsonUnsafe({ error: error.message }, { status: 400 })),
    DnsError: (error) => Effect.succeed(HttpServerResponse.jsonUnsafe({ error: error.message }, { status: 502 })),
  }),
)

const describe = HttpServerResponse.jsonUnsafe({
  name: "smtp-submission-test",
  description:
    "Test a mail server's submission port (587/465/2525) over raw TCP: read the banner, EHLO, upgrade with STARTTLS when offered (implicit TLS on 465), EHLO again, and return the capabilities plus the full SMTP transcript. Only public hostnames are allowed.",
  params: {
    host: "Mail server hostname, e.g. smtp.example.com (required)",
    port: "587 (default, STARTTLS), 465 (implicit TLS) or 2525. Port 25 is blocked from Workers.",
  },
  example: "/api?host=smtp.gmail.com&port=587",
})

const routes = Layer.mergeAll(
  HttpRouter.add("GET", "/", describe),
  HttpRouter.add("GET", "/api", api),
)

export default Worker.make({ layer: FetchHttpClient.layer, fetch: routes })
