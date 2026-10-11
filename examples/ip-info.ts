/**
 * @title IP info
 * @difficulty beginner
 * @tags workers, http, schema, network
 * @group Network
 * @resource {https://developers.cloudflare.com/workers/runtime-apis/request/#incomingrequestcfproperties} Cloudflare: request.cf
 * @resource {https://effect.website/docs/schema/introduction/} Effect: Schema
 * @resource {https://tools.mikepage.nl/ip-info} Original tool: tools.mikepage.nl/ip-info
 * @check GET / -> 200 "ip_info" "/api"
 * @check GET /api h:cf-connecting-ip=192.0.2.7 -> 200 "\"ip\":\"192.0.2.7\"" "\"version\":4" "\"isEU\"" header:access-control-allow-origin~"*" header:cache-control~"no-store"
 * @check GET /json h:cf-connecting-ip=2a01:4f8::7 -> 200 "\"ip\":\"2a01:4f8::7\"" "\"version\":6"
 * @check GET /ip h:cf-connecting-ip=2a01:4f8::7 -> 200 "2a01:4f8::7" header:access-control-allow-origin~"*"
 * @check GET /api?fields=ip,version h:cf-connecting-ip=192.0.2.7 -> 200 "\"ip\":\"192.0.2.7\"" "\"version\":4" !"isEU"
 * @check GET /api?fields=ip,password -> 400 "fields must be a comma-separated list of"
 *
 * Your IP address and where it is (city, country, timezone, network) as
 * a CORS-enabled JSON endpoint that replaces ipinfo.io and ip-api. A Worker
 * gets all of this for free on `request.cf`; the example decodes that
 * untrusted object with a Schema into `Option`s, since `cf` and
 * `CF-Connecting-IP` are missing outside Cloudflare's edge.
 */

import { Effect, Layer, Option, Schema, SchemaIssue } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import * as Worker from "@mikepage/flareosaur/workers/worker"

// The part of request.cf this tool reads. Every field is optional, and
// Cloudflare sends some as strings ("52.37") and some as numbers (asn).
const Scalar = Schema.Union([Schema.String, Schema.Number, Schema.Boolean])
const Cf = Schema.Struct({
  city: Schema.optional(Scalar),
  region: Schema.optional(Scalar),
  regionCode: Schema.optional(Scalar),
  country: Schema.optional(Scalar),
  continent: Schema.optional(Scalar),
  isEUCountry: Schema.optional(Scalar),
  postalCode: Schema.optional(Scalar),
  metroCode: Schema.optional(Scalar),
  latitude: Schema.optional(Scalar),
  longitude: Schema.optional(Scalar),
  timezone: Schema.optional(Scalar),
  asn: Schema.optional(Schema.Number),
  asOrganization: Schema.optional(Scalar),
  colo: Schema.optional(Scalar),
})
type Cf = typeof Cf.Type

// The Web Request behind the Effect request carries `cf` on Workers. In
// Miniflare or a plain fetch it may be missing, so it comes back as an
// Option, decoded by the schema above.
const requestCf = (request: HttpServerRequest.HttpServerRequest): Option.Option<Cf> =>
  Option.fromNullishOr((request.source as { cf?: unknown }).cf).pipe(Option.flatMap(Schema.decodeUnknownOption(Cf)))

const clientIp = (request: HttpServerRequest.HttpServerRequest): Option.Option<string> =>
  Option.fromNullishOr(request.headers["cf-connecting-ip"])

// The ipinfo.io/json shape, with extras. Absent values are undefined, so
// JSON.stringify leaves them out, as the original did.
const ipInfo = (ip: Option.Option<string>, cf: Option.Option<Cf>) => {
  const field = (key: keyof Cf): Option.Option<string> =>
    Option.flatMap(cf, (c) => Option.fromNullishOr(c[key])).pipe(Option.map(String))
  const str = (key: keyof Cf) => Option.getOrUndefined(field(key))
  const asn = Option.getOrUndefined(Option.flatMap(cf, (c) => Option.fromNullishOr(c.asn)))
  const org = str("asOrganization")
  const loc = Option.zipWith(field("latitude"), field("longitude"), (lat, lon) => `${lat},${lon}`)
  return {
    ip: Option.getOrUndefined(ip),
    version: Option.getOrUndefined(Option.map(ip, (a) => (a.includes(":") ? 6 : 4))),
    city: str("city"),
    region: str("region"),
    regionCode: str("regionCode"),
    country: str("country"),
    continent: str("continent"),
    isEU: Option.exists(field("isEUCountry"), (v) => v === "1" || v === "true"),
    postal: str("postalCode"),
    metroCode: str("metroCode"),
    loc: Option.getOrUndefined(loc),
    timezone: str("timezone"),
    asn,
    org: asn ? `AS${asn}${org ? ` ${org}` : ""}` : org,
    colo: str("colo"),
  }
}
type IpInfo = ReturnType<typeof ipInfo>

const FIELDS: ReadonlyArray<keyof IpInfo> = [
  "ip", "version", "city", "region", "regionCode", "country", "continent", "isEU",
  "postal", "metroCode", "loc", "timezone", "asn", "org", "colo",
]

// Optional ?fields=ip,country picks a subset, like ipinfo.io's field
// filter. Unknown names are a 400.
const splitFields = (s: string): ReadonlyArray<string> => s.split(",").map((f) => f.trim()).filter(Boolean)
const Fields = Schema.String.check(
  Schema.makeFilter((s: string) => splitFields(s).every((f) => (FIELDS as ReadonlyArray<string>).includes(f)), {
    message: `fields must be a comma-separated list of: ${FIELDS.join(", ")}`,
  }),
)
const Query = Schema.Struct({ fields: Schema.OptionFromOptional(Fields) })

// Callable from any origin, and never cached: the answer is per caller.
const headers = { "access-control-allow-origin": "*", "cache-control": "no-store" }

// "<param>: <message>" for each problem in the query string.
const standard = SchemaIssue.makeFormatterStandardSchemaV1()
const formatIssue = (issue: SchemaIssue.Issue): string =>
  standard(issue).issues
    .map((i) => {
      const path = (i.path ?? []).map((p) => String(typeof p === "object" ? p.key : p)).join(".")
      return path ? `${path}: ${i.message}` : i.message
    })
    .join("; ")

const json = Effect.gen(function*() {
  const { fields } = yield* HttpServerRequest.schemaSearchParams(Query)
  const request = yield* HttpServerRequest.HttpServerRequest
  const info = ipInfo(clientIp(request), requestCf(request))
  const body = Option.match(fields, {
    onNone: () => info,
    onSome: (list) => Object.fromEntries(splitFields(list).map((k) => [k, info[k as keyof IpInfo]])),
  })
  return HttpServerResponse.jsonUnsafe(body, { headers })
}).pipe(
  Effect.catchTag("SchemaError", (error) =>
    Effect.succeed(
      HttpServerResponse.jsonUnsafe(
        { error: formatIssue(error.issue) },
        { status: 400, headers },
      ),
    )),
)

// Just the address, as text, for `curl .../ip`.
const ipText = Effect.map(
  HttpServerRequest.HttpServerRequest,
  (request) => HttpServerResponse.text(`${Option.getOrElse(clientIp(request), () => "")}\n`, { headers }),
)

const describeTool = HttpServerResponse.jsonUnsafe({
  name: "ip_info",
  description:
    "Your IP address and where it is (city, region, country, timezone, network) from request.cf. CORS-enabled, so any site can call it instead of ipinfo.io or ip-api.",
  params: { fields: "Optional comma-separated subset of the result fields, e.g. ip,country" },
  endpoints: { "/api": "JSON (also at /json)", "/ip": "the address as plain text" },
  example: "/api?fields=ip,city,country",
})

const routes = Layer.mergeAll(
  HttpRouter.add("GET", "/", describeTool),
  HttpRouter.add("GET", "/api", json),
  HttpRouter.add("GET", "/json", json),
  HttpRouter.add("GET", "/ip", ipText),
)

export default Worker.make({ fetch: routes })
