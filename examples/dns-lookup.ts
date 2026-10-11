/**
 * @title DNS lookup over DNS-over-HTTPS
 * @difficulty intermediate
 * @tags workers, http, dns, schema
 * @group DNS & domains
 * @resource {https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/make-api-requests/dns-json/} Cloudflare: DoH JSON API
 * @resource {https://developers.google.com/speed/public-dns/docs/doh/json} Google Public DNS: JSON API
 * @resource {https://effect.website/docs/platform/http-client/} Effect: HttpClient
 * @check GET / -> 200 "\"name\":\"dns-lookup\"" "/api?name=example.com"
 * @check GET /api?name=cloudflare.com&type=A&resolver=cloudflare&dnssec=true -> 200 "\"statusText\":\"No error\"" "\"validated\":true" "\"queryTime\":"
 * @check GET /api?name=google.com&type=A -> 200 "\"validated\":false"
 * @check GET /api?name=does-not-exist-flareosaur.example.invalid&type=A -> 200 "\"statusText\":\"Non-existent domain\""
 * @check GET /api?name=google.com&type=mx&resolver=google -> 200 "\"type\":\"MX\"" "\"resolver\":\"google\"" "\"preference\":" "google.com\"}"
 * @check GET /api?name=www.github.com&type=A -> 200 "\"type\":5" "\"records\":[\""
 * @check GET /api?name=cloudflare.com&type=NS -> 200 "cloudflare.com\"" !"cloudflare.com.\"]"
 * @check GET /api?name=cloudflare.com&type=SOA -> 200 "\"mname\":" "\"serial\":" "\"minimum\":"
 * @check GET /api?name=cloudflare.com&type=A&dnssec=false -> 200 "\"CD\":true" "\"enabled\":false"
 * @check GET /api?name=google.com&type=TXT -> 200 "\"v=spf1"
 * @check GET /api?domain=_dmarc.google.com&type=TXT -> 200 "v=DMARC1"
 * @check GET /api?name=example.com&resolver=quad9 -> 400 "\"error\":"
 * @check GET /api?name=nope -> 400 "\"error\":"
 * @check GET /api?name=example.com&type=AXFR -> 400 "\"error\":"
 * @check GET /api -> 400 "\"error\":"
 *
 * Query one DNS record type for a name over DNS-over-HTTPS, from Cloudflare's
 * 1.1.1.1 resolvers or Google's. The query string is decoded with a Schema,
 * the resolver's JSON answer is fetched with `HttpClient` under a timeout and
 * decoded with a Schema too, and a failing resolver is a typed error that
 * becomes a 502.
 */

import { type Cause, Duration, Effect, Layer, Schema, SchemaTransformation } from "effect"
import { FetchHttpClient, HttpClient, HttpClientResponse, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import * as Worker from "@mikepage/flareosaur/workers/worker"

// --- The record types and resolvers the tool knows ---------------------------

const RECORD_TYPES = ["A", "AAAA", "CNAME", "MX", "NS", "TXT", "SOA", "CAA", "SRV", "PTR"] as const
type RecordType = (typeof RECORD_TYPES)[number]

// The numeric type code is what a DoH answer carries for each record.
const TYPE_CODES: Record<RecordType, number> = {
  A: 1,
  AAAA: 28,
  CNAME: 5,
  MX: 15,
  NS: 2,
  TXT: 16,
  SOA: 6,
  CAA: 257,
  SRV: 33,
  PTR: 12,
}

// DNS-over-HTTPS resolvers that speak the JSON API (application/dns-json).
const RESOLVERS = {
  cloudflare: { label: "Cloudflare (1.1.1.1)", url: "https://cloudflare-dns.com/dns-query" },
  "cloudflare-security": { label: "Cloudflare Security (1.1.1.2)", url: "https://security.cloudflare-dns.com/dns-query" },
  "cloudflare-family": { label: "Cloudflare Family (1.1.1.3)", url: "https://family.cloudflare-dns.com/dns-query" },
  google: { label: "Google (8.8.8.8)", url: "https://dns.google/resolve" },
} as const
type Resolver = keyof typeof RESOLVERS

// RCODE -> text, for the Status field of a DoH answer.
const DNS_STATUS: Record<number, string> = {
  0: "No error",
  1: "Format error",
  2: "Server failure",
  3: "Non-existent domain",
  4: "Not implemented",
  5: "Query refused",
}

// --- Input: the query string, decoded with a Schema --------------------------

// DNS names rather than hostnames: `_dmarc.`, `selector._domainkey.` and
// `_sip._tcp.` labels are common lookups, so a label may start with `_`.
const DNS_LABEL = /^_?[a-z0-9]([a-z0-9-_]{0,61}[a-z0-9])?$/i
const isDnsName = (input: string): boolean => {
  const labels = input.replace(/\.$/, "").split(".")
  return input.length <= 253 && labels.length >= 2 && labels.every((l) => DNS_LABEL.test(l))
}

const DnsName = Schema.String.pipe(
  Schema.decode(SchemaTransformation.trim()),
  Schema.check(Schema.makeFilter(isDnsName, { expected: "a DNS name such as example.com" })),
)

// `type=mx` works as well as `type=MX`.
const RecordTypeParam = Schema.String.pipe(
  Schema.decode(SchemaTransformation.toUpperCase()),
  Schema.decodeTo(Schema.Literals(RECORD_TYPES)),
)

const ResolverParam = Schema.Literals(Object.keys(RESOLVERS) as Array<Resolver>)

// DNSSEC is on unless the value says otherwise (`false`, `0`, `off`, `disabled`).
const DnssecParam = Schema.String.pipe(
  Schema.decodeTo(
    Schema.Boolean,
    SchemaTransformation.transform({
      decode: (s) => !/^(false|0|off|disabled?)$/i.test(s),
      encode: (b) => String(b),
    }),
  ),
)

// The original tool also accepted `domain` as an alias for `name`.
const LookupParams = Schema.Struct({
  name: Schema.optional(DnsName),
  domain: Schema.optional(DnsName),
  type: Schema.optional(RecordTypeParam),
  resolver: Schema.optional(ResolverParam),
  dnssec: Schema.optional(DnssecParam),
})

// --- The resolver's answer, decoded with a Schema ----------------------------

const DohAnswer = Schema.Struct({ name: Schema.String, type: Schema.Number, TTL: Schema.Number, data: Schema.String })

// Fields we do not model (Question, Comment, ...) are kept as they came, so
// the API returns the raw DoH response plus the parsed view.
const DohResponse = Schema.StructWithRest(
  Schema.Struct({
    Status: Schema.Number,
    AD: Schema.optional(Schema.Boolean),
    CD: Schema.optional(Schema.Boolean),
    Answer: Schema.optional(Schema.Array(DohAnswer)),
    Authority: Schema.optional(Schema.Array(DohAnswer)),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)
type DohResponse = typeof DohResponse.Type

// Anything that goes wrong talking to the resolver: a network error, a non-2xx
// status, a body that does not decode, or no answer within five seconds.
class DohError extends Schema.TaggedError<DohError>()("DohError", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

const describe = (cause: { readonly _tag: string; readonly message?: string }): string =>
  cause._tag === "TimeoutError" ? "the resolver did not answer within 5s" : cause.message ?? cause._tag

const dohQuery = Effect.fnUntraced(function*(name: string, type: RecordType, resolver: Resolver, dnssec: boolean) {
  const client = yield* HttpClient.HttpClient
  return yield* client.get(RESOLVERS[resolver].url, {
    // dnssec=false sends cd=1 (checking disabled), useful for domains with
    // broken DNSSEC; otherwise ask for validation with do=1.
    urlParams: { name, type, ...(dnssec ? { do: "1" } : { cd: "1" }) },
    headers: { accept: "application/dns-json" },
  }).pipe(
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap(HttpClientResponse.schemaBodyJson(DohResponse)),
    Effect.timeout("5 seconds"),
    Effect.mapError((cause: { readonly _tag: string; readonly message?: string } | Cause.TimeoutError) =>
      new DohError({ message: `DNS lookup failed: ${describe(cause)}`, cause })
    ),
  )
})

// --- Parsing the answers ------------------------------------------------------

interface Mx {
  readonly preference: number
  readonly exchange: string
}

interface Soa {
  readonly mname: string
  readonly rname: string
  readonly serial: number
  readonly refresh: number
  readonly retry: number
  readonly expire: number
  readonly minimum: number
}

type RecordValue = string | Mx | Soa

const noDot = (s: string): string => s.replace(/\.$/, "")

// TXT data arrives as one or more quoted strings: `"part1" "part2"`.
const unquoteTxt = (data: string): string =>
  data.split(/"\s+"/).map((s) => s.replace(/^"|"$/g, "")).join("")

const parseRecord = (type: RecordType, data: string): RecordValue => {
  switch (type) {
    case "MX": {
      const [preference = "0", ...rest] = data.split(" ")
      return { preference: parseInt(preference, 10), exchange: noDot(rest.join(" ")) }
    }
    case "SOA": {
      const p = data.split(" ")
      const n = (i: number) => parseInt(p[i] ?? "", 10) || 0
      return {
        mname: noDot(p[0] ?? ""),
        rname: noDot(p[1] ?? ""),
        serial: n(2),
        refresh: n(3),
        retry: n(4),
        expire: n(5),
        minimum: n(6),
      }
    }
    case "TXT":
      return unquoteTxt(data)
    case "CNAME":
    case "NS":
    case "PTR":
    case "SRV":
      return noDot(data)
    default:
      return data
  }
}

// --- The lookup ---------------------------------------------------------------

const lookup = Effect.fnUntraced(function*(name: string, type: RecordType, resolver: Resolver, dnssec: boolean) {
  // Effect.timed measures the resolver round trip.
  const [elapsed, res] = yield* Effect.timed(dohQuery(name, type, resolver, dnssec))
  // Only answers of the requested type: a CNAME chain shows up in Answer too.
  const answers = (res.Answer ?? []).filter((a) => a.type === TYPE_CODES[type])
  return {
    ...res,
    name,
    type,
    resolver,
    queryTime: Math.round(Duration.toMillis(elapsed)),
    statusText: DNS_STATUS[res.Status] ?? `DNS error ${res.Status}`,
    // validated mirrors the AD bit; enabled is false when sent with cd=1.
    dnssec: { enabled: dnssec, validated: res.AD === true },
    records: answers.map((a) => parseRecord(type, a.data)),
  } satisfies DohResponse & Record<string, unknown>
})

const badRequest = (error: string) => HttpServerResponse.jsonUnsafe({ error }, { status: 400 })

const api = Effect.gen(function*() {
  const params = yield* HttpServerRequest.schemaSearchParams(LookupParams)
  const name = params.name ?? params.domain
  if (name === undefined) return badRequest("name is required, e.g. ?name=example.com")
  const result = yield* lookup(name, params.type ?? "A", params.resolver ?? "cloudflare", params.dnssec ?? true)
  return HttpServerResponse.jsonUnsafe(result)
}).pipe(
  Effect.catchTag("SchemaError", (e) => Effect.succeed(badRequest(e.message))),
  // The resolver failed: that is the upstream's fault, so 502.
  Effect.catchTag("DohError", (e) => Effect.succeed(HttpServerResponse.jsonUnsafe({ error: e.message }, { status: 502 }))),
)

// --- Routes -------------------------------------------------------------------

const about = HttpServerResponse.jsonUnsafe({
  name: "dns-lookup",
  description:
    "Query a DNS record for a domain over DNS-over-HTTPS. Returns the raw DoH JSON response plus resolver, queryTime (ms), statusText, dnssec (AD bit) and records: answers of the requested type, parsed (MX -> preference/exchange, SOA -> fields, TXT unquoted).",
  params: {
    name: "Domain name to query, e.g. example.com (required; `domain` works too)",
    type: `Record type, one of ${RECORD_TYPES.join(", ")} (default A)`,
    resolver: `DoH resolver, one of ${Object.keys(RESOLVERS).join(", ")} (default cloudflare)`,
    dnssec: "true asks for DNSSEC validation (do=1, default); false disables checking (cd=1)",
  },
  example: "/api?name=example.com&type=MX&resolver=cloudflare&dnssec=true",
})

export default Worker.make({
  layer: FetchHttpClient.layer,
  fetch: Layer.mergeAll(
    HttpRouter.add("GET", "/", about),
    HttpRouter.add("GET", "/api", api),
  ),
})
