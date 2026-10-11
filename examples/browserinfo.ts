/**
 * @title Browser info
 * @difficulty intermediate
 * @tags workers, http, schema, network, dns
 * @group Network
 * @resource {https://developers.cloudflare.com/workers/runtime-apis/request/#incomingrequestcfproperties} Cloudflare: request.cf
 * @resource {https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Client_hints} MDN: HTTP Client Hints
 * @resource {https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/make-api-requests/dns-json/} Cloudflare: DNS over HTTPS (JSON)
 * @resource {https://effect.website/docs/platform/http-client/} Effect: HttpClient
 * @resource {https://tools.mikepage.nl/browserinfo} Original tool: tools.mikepage.nl/browserinfo
 * @check GET / -> 200 "browserinfo" "/api" "/ptr?ip="
 * @check GET /api h:cf-connecting-ip=192.168.1.10 h:user-agent=flareosaur-check h:accept-language=nl-NL -> 200 "\"ip\":\"192.168.1.10\"" "\"version\":4" "\"user-agent\":\"flareosaur-check\"" "\"accept-language\":\"nl-NL\"" "\"ptr\":null" header:accept-ch~"Sec-CH-UA-Full-Version-List" header:cache-control~"no-store"
 * @check GET /api?ptr=false h:sec-ch-ua="\"Chromium\";v=\"128\", \"Not;A=Brand\";v=\"24\", \"Google Chrome\";v=\"128\"" h:sec-ch-ua-mobile=?0 h:sec-ch-ua-platform="\"macOS\"" -> 200 "\"browser\":\"Google Chrome 128\"" "\"platform\":\"macOS\"" "\"mobile\":false"
 * @check GET /api?ptr=false h:sec-ch-ua-full-version-list="\"Not A(Brand\";v=\"8.0.0.0\", \"Chromium\";v=\"132.0.6834.83\"" h:sec-ch-ua-mobile=?1 -> 200 "\"browser\":\"Chromium 132.0.6834.83\"" "\"mobile\":true"
 * @check GET /api?ptr=maybe -> 400 "error"
 * @check GET /api?ptr=true h:cf-connecting-ip=1.1.1.1 -> 200 "\"hostname\":\"one.one.one.one\""
 * @check GET /ptr?ip=1.1.1.1 -> 200 "\"ip\":\"1.1.1.1\"" "\"name\":\"1.1.1.1.in-addr.arpa\"" "\"hostname\":\"one.one.one.one\""
 * @check GET /ptr?ip=2606:4700:4700::1111 -> 200 "\"name\":\"1.1.1.1.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.7.4.0.0.7.4.6.0.6.2.ip6.arpa\"" "\"hostname\":\"one.one.one.one\""
 * @check GET /ptr?ip=example.com -> 400 "{\"error\":\"Invalid IP address\"}"
 * @check GET /ptr?ip=300.1.1.1 -> 400 "Invalid IP address"
 * @check GET /ptr?ip=01.1.1.1 -> 400 "Invalid IP address"
 * @check GET /ptr?ip=2001:db8:::1 -> 400 "Invalid IP address"
 * @check GET /ptr?ip=fe80::1%25eth0 -> 400 "Invalid IP address"
 * @check GET /ptr?ip=::ffff:999.0.0.1 -> 400 "Invalid IP address"
 * @check GET /ptr -> 400 "Invalid IP address"
 *
 * What this Worker sees of your connection: the request headers, the
 * User-Agent Client Hints (asked for with `Accept-CH`), Cloudflare's
 * `request.cf` (country, city, colo, ASN, TLS, HTTP protocol) and your IP
 * with its PTR record. The PTR lookup is DNS over HTTPS through
 * `HttpClient`, with a timeout, a Schema-decoded answer and a typed error.
 */

import { Duration, Effect, Layer, Option, Schema, SchemaIssue } from "effect"
import {
  FetchHttpClient,
  HttpClient,
  HttpClientResponse,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http"
import * as Worker from "@mikepage/flareosaur/workers/worker"

// --- IP literals and reverse names (pure) -------------------------------------

// Four decimal octets 0-255 with no leading zeros, so 010.1.1.1 is rejected
// rather than read as octal or decimal.
const isIpv4 = (ip: string): boolean => {
  const parts = ip.split(".")
  return parts.length === 4 && parts.every((p) => /^(0|[1-9]\d{0,2})$/.test(p) && Number(p) <= 255)
}

// Eight zero-padded groups, or None when the input is not IPv6.
const expandIpv6 = (input: string): Option.Option<string> => {
  const parts = input.split("::")
  if (parts.length > 2) return Option.none()
  let groups: Array<string>
  if (parts.length === 2) {
    const left = parts[0] ? parts[0].split(":") : []
    const right = parts[1] ? parts[1].split(":") : []
    const missing = 8 - left.length - right.length
    if (missing < 1) return Option.none()
    groups = [...left, ...Array<string>(missing).fill("0"), ...right]
  } else {
    groups = parts[0]!.split(":")
  }
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return Option.none()
  return Option.some(groups.map((g) => g.padStart(4, "0").toLowerCase()).join(":"))
}

// An IPv6 literal, including an embedded IPv4 tail like ::ffff:192.0.2.1.
// Zone ids (fe80::1%eth0) are not addresses you can look up.
const expandIpv6Literal = (ip: string): Option.Option<string> => {
  if (!ip.includes(":") || ip.includes("%")) return Option.none()
  const tail = ip.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/)
  if (!tail) return expandIpv6(ip)
  if (!isIpv4(tail[2]!)) return Option.none()
  const [a, b, c, d] = tail[2]!.split(".").map(Number) as [number, number, number, number]
  const hex = (hi: number, lo: number) => ((hi << 8) | lo).toString(16)
  return expandIpv6(`${tail[1]}${hex(a, b)}:${hex(c, d)}`)
}

// The reverse-DNS name: 4.3.2.1.in-addr.arpa for IPv4, the 32 reversed
// nibbles under ip6.arpa for IPv6. None when it is not an IP literal.
const reverseName = (input: string): Option.Option<string> => {
  const ip = input.trim()
  if (isIpv4(ip)) return Option.some(`${ip.split(".").reverse().join(".")}.in-addr.arpa`)
  return Option.map(expandIpv6Literal(ip), (full) => `${full.replace(/:/g, "").split("").reverse().join(".")}.ip6.arpa`)
}

// Private, CGNAT, link-local, loopback and unique-local addresses have no
// public PTR record worth a lookup.
const isPrivate = (ip: string): boolean => {
  if (isIpv4(ip)) {
    const [a, b] = ip.split(".").map(Number) as [number, number]
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224
  }
  return Option.match(expandIpv6Literal(ip), {
    onNone: () => true,
    onSome: (full) =>
      full === "0000:0000:0000:0000:0000:0000:0000:0000" || full === "0000:0000:0000:0000:0000:0000:0000:0001" ||
      /^fe[89ab]/.test(full) || /^f[cd]/.test(full) || full.startsWith("0000:0000:0000:0000:0000:ffff:"),
  })
}

// --- PTR over DNS over HTTPS -------------------------------------------------

// The part of a DoH JSON answer the lookup reads; unknown keys are ignored.
const DohResponse = Schema.Struct({
  Status: Schema.Number,
  Answer: Schema.optional(Schema.Array(Schema.Struct({ type: Schema.Number, data: Schema.String }))),
})

// The resolver could not be reached, timed out, answered non-2xx or sent
// something that is not a DoH answer. Mapped to 502.
class PtrError extends Schema.TaggedError<PtrError>()("PtrError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

interface PtrResult {
  readonly ip: string
  readonly name: string
  /** Every PTR target, trailing dot stripped; usually zero or one. */
  readonly hostnames: ReadonlyArray<string>
  readonly hostname: string | null
}

const ptrLookup = Effect.fnUntraced(function*(ip: string, name: string) {
  const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)
  const answer = yield* client.get("https://cloudflare-dns.com/dns-query", {
    urlParams: { name, type: "PTR" },
    headers: { accept: "application/dns-json" },
  }).pipe(
    Effect.flatMap(HttpClientResponse.schemaBodyJson(DohResponse)),
    Effect.timeout(Duration.seconds(5)),
    Effect.mapError((cause) =>
      new PtrError({
        message: cause._tag === "TimeoutError" ? "DoH query timed out" : `DoH query failed: ${cause.message}`,
        cause,
      })
    ),
  )
  // Type 12 is PTR; a CNAME in the chain (type 5) is skipped.
  const hostnames = (answer.Answer ?? []).filter((a) => a.type === 12).map((a) => a.data.replace(/\.$/, ""))
  return { ip, name, hostnames, hostname: hostnames[0] ?? null } satisfies PtrResult
})

// --- Client Hints (pure) -------------------------------------------------------

// The hints the server asks for. Browsers that support them send these on
// the next request to this origin (low-entropy ones are always sent).
const CLIENT_HINTS = [
  "Sec-CH-UA",
  "Sec-CH-UA-Mobile",
  "Sec-CH-UA-Platform",
  "Sec-CH-UA-Platform-Version",
  "Sec-CH-UA-Full-Version-List",
  "Sec-CH-UA-Model",
  "Sec-CH-UA-Arch",
  "Sec-CH-UA-Bitness",
]

interface Brand {
  readonly brand: string
  readonly version: string
}

// A brand list is a structured header: "Chromium";v="128", "Google Chrome";v="128".
const parseBrands = (header: string): ReadonlyArray<Brand> =>
  [...header.matchAll(/"((?:[^"\\]|\\.)*)"\s*;\s*v="([^"]*)"/g)].map((m) => ({ brand: m[1]!, version: m[2]! }))

// Skip the GREASE entry ("Not;A=Brand", "Not A(Brand") and prefer a real
// brand over the generic "Chromium".
const pickBrand = (brands: ReadonlyArray<Brand>): Option.Option<Brand> => {
  const real = brands.filter((b) => !/not.?a.?brand/i.test(b.brand))
  return Option.fromNullishOr(real.find((b) => b.brand !== "Chromium") ?? real[0])
}

// Structured-header strings arrive quoted: "macOS".
const unquote = (s: string): string => s.replace(/^"(.*)"$/, "$1")

const clientHints = (headers: Readonly<Record<string, string | undefined>>) => {
  const header = (name: string) => Option.fromNullishOr(headers[name.toLowerCase()])
  // The full version list is high-entropy and more precise; fall back to Sec-CH-UA.
  const brand = Option.firstSomeOf([
    Option.flatMap(header("Sec-CH-UA-Full-Version-List"), (h) => pickBrand(parseBrands(h))),
    Option.flatMap(header("Sec-CH-UA"), (h) => pickBrand(parseBrands(h))),
  ])
  const str = (name: string) => Option.getOrUndefined(Option.map(header(name), unquote))
  return {
    browser: Option.getOrUndefined(Option.map(brand, (b) => `${b.brand} ${b.version}`)),
    platform: str("Sec-CH-UA-Platform"),
    platformVersion: str("Sec-CH-UA-Platform-Version"),
    mobile: Option.getOrUndefined(Option.map(header("Sec-CH-UA-Mobile"), (m) => m.trim() === "?1")),
    model: str("Sec-CH-UA-Model"),
    arch: str("Sec-CH-UA-Arch"),
    bitness: str("Sec-CH-UA-Bitness"),
    raw: Object.fromEntries(CLIENT_HINTS.flatMap((h) => Option.toArray(Option.map(header(h), (v) => [h.toLowerCase(), v])))),
  }
}

// --- request.cf ------------------------------------------------------------------

// The fields of request.cf the original page showed, all optional.
const Scalar = Schema.Union([Schema.String, Schema.Number])
const Cf = Schema.Struct({
  colo: Schema.optional(Scalar),
  country: Schema.optional(Scalar),
  city: Schema.optional(Scalar),
  region: Schema.optional(Scalar),
  postalCode: Schema.optional(Scalar),
  timezone: Schema.optional(Scalar),
  asn: Schema.optional(Scalar),
  asOrganization: Schema.optional(Scalar),
  httpProtocol: Schema.optional(Scalar),
  tlsVersion: Schema.optional(Scalar),
  tlsCipher: Schema.optional(Scalar),
})

// `cf` is on the Web Request behind the Effect request, and missing outside
// Cloudflare's edge, so decoding it gives an Option.
const requestCf = (request: HttpServerRequest.HttpServerRequest): Option.Option<typeof Cf.Type> =>
  Option.fromNullishOr((request.source as { cf?: unknown }).cf).pipe(Option.flatMap(Schema.decodeUnknownOption(Cf)))

// The plain headers worth showing (Client Hints are reported separately).
const HEADERS = ["user-agent", "accept", "accept-language", "accept-encoding", "dnt", "sec-gpc", "referer"]

// --- Input -------------------------------------------------------------------------

const ApiQuery = Schema.Struct({
  // ptr=false skips the reverse lookup of your IP.
  ptr: Schema.OptionFromOptional(Schema.Literals(["true", "false", "1", "0"])),
})
const PtrQuery = Schema.Struct({ ip: Schema.OptionFromOptional(Schema.String) })

// "<param>: <message>" for each problem in the query string.
const standard = SchemaIssue.makeFormatterStandardSchemaV1()
const formatIssue = (issue: SchemaIssue.Issue): string =>
  standard(issue).issues
    .map((i) => {
      const path = (i.path ?? []).map((p) => String(typeof p === "object" ? p.key : p)).join(".")
      return path ? `${path}: ${i.message}` : i.message
    })
    .join("; ")
const json = (body: unknown, status = 200) =>
  HttpServerResponse.jsonUnsafe(body, {
    status,
    headers: {
      "accept-ch": CLIENT_HINTS.join(", "),
      "vary": CLIENT_HINTS.join(", "),
      "cache-control": "no-store",
    },
  })

// --- Routes --------------------------------------------------------------------------

const describeTool = HttpServerResponse.jsonUnsafe({
  name: "browserinfo",
  description:
    "What this Worker sees of your connection: request headers, User-Agent Client Hints, request.cf (country, city, colo, ASN, TLS, HTTP protocol) and your IP with its PTR record.",
  params: { ptr: "true (default) or false: look up the PTR record of your IP" },
  endpoints: {
    "/api": "everything the server sees of this request",
    "/ptr?ip=1.1.1.1": "the PTR record of any IPv4 or IPv6 address",
  },
  example: "/api",
})

const api = Effect.gen(function*() {
  const query = yield* HttpServerRequest.schemaSearchParams(ApiQuery)
  const request = yield* HttpServerRequest.HttpServerRequest
  const ip = Option.fromNullishOr(request.headers["cf-connecting-ip"])
  const wantPtr = Option.match(query.ptr, { onNone: () => true, onSome: (p) => p === "true" || p === "1" })

  // A failed lookup does not fail the whole answer: it is reported next to it.
  const lookup = Option.flatMap(
    Option.filter(ip, (a) => wantPtr && !isPrivate(a)),
    (a) => Option.map(reverseName(a), (name) => ptrLookup(a, name)),
  )
  const ptr = yield* Option.match(lookup, {
    onNone: () => Effect.succeed({ ptr: null }),
    onSome: (effect) =>
      effect.pipe(
        Effect.map((ptr) => ({ ptr })),
        Effect.catchTag("PtrError", (e) => Effect.succeed({ ptr: null, ptrError: e.message })),
      ),
  })

  const cf = Option.getOrElse(requestCf(request), () => ({}))
  return json({
    ip: Option.getOrUndefined(ip),
    version: Option.getOrUndefined(Option.map(ip, (a) => (a.includes(":") ? 6 : 4))),
    ...ptr,
    cf,
    headers: Object.fromEntries(HEADERS.flatMap((h) => (request.headers[h] ? [[h, request.headers[h]]] : []))),
    clientHints: clientHints(request.headers),
  })
}).pipe(
  Effect.catchTag("SchemaError", (error) =>
    Effect.succeed(json({ error: formatIssue(error.issue) }, 400))),
)

// GET /ptr?ip=: reverse DNS for any address, as the original tool's browser
// page used for the IPs it found over WebRTC.
const ptr = Effect.gen(function*() {
  const query = yield* HttpServerRequest.schemaSearchParams(PtrQuery)
  const ip = Option.map(query.ip, (s) => s.trim())
  const name = Option.flatMap(ip, reverseName)
  if (Option.isNone(ip) || Option.isNone(name)) {
    return HttpServerResponse.jsonUnsafe({ error: "Invalid IP address" }, { status: 400 })
  }
  const result = yield* ptrLookup(ip.value, name.value)
  return HttpServerResponse.jsonUnsafe(result, { headers: { "cache-control": "public, max-age=300" } })
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(HttpServerResponse.jsonUnsafe({ error: "Invalid IP address" }, { status: 400 })),
    PtrError: (e) => Effect.succeed(HttpServerResponse.jsonUnsafe({ error: e.message }, { status: 502 })),
  }),
)

const routes = Layer.mergeAll(
  HttpRouter.add("GET", "/", describeTool),
  HttpRouter.add("GET", "/api", api),
  HttpRouter.add("GET", "/ptr", ptr),
)

// FetchHttpClient.layer is built once per isolate and handed to the routes.
export default Worker.make({ layer: FetchHttpClient.layer, fetch: routes })
