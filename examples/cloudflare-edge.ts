/**
 * @title Cloudflare edge
 * @difficulty beginner
 * @tags workers, http, schema, network
 * @group Network
 * @resource {https://developers.cloudflare.com/workers/runtime-apis/request/#incomingrequestcfproperties} Cloudflare: request.cf
 * @resource {https://github.com/Netrvin/cloudflare-colo-list} Cloudflare colo list (MIT)
 * @resource {https://tools.mikepage.nl/cloudflare-edge} Original tool: tools.mikepage.nl/cloudflare-edge
 * @check GET / -> 200 "cloudflare_colo" "/api?colo="
 * @check GET /api?colo=NRT -> 200 "\"code\":\"NRT\"" "\"city\":\"Tokyo\"" "\"country\":\"Japan\""
 * @check GET /api?colo=ams -> 200 "\"code\":\"AMS\"" "\"city\":\"Amsterdam\"" "\"cca2\":\"NL\""
 * @check GET /api?colo=ZZZ -> 400 "unknown colo ZZZ"
 * @check GET /api?colo=AMST -> 400 "colo must be a three-letter IATA code"
 * @check GET /api -> 400 "error"
 * @check GET /edge -> 200 "\"servedBy\"" "\"visitor\""
 * @check GET /edge?colo=AMS -> 200 "\"code\":\"AMS\"" "\"city\":\"Amsterdam\""
 * @check GET /colos?region=Europe -> 200 "\"region\":\"Europe\"" "\"code\":\"AMS\"" !"\"code\":\"NRT\""
 * @check GET /colos -> 200 "\"count\":342" "\"regions\":[\"Africa\""
 * @check GET /colos?region=Mars -> 400 "error"
 *
 * Which Cloudflare data center is serving you, where it is, and how far it
 * is from you. The colo code and your location come free on `request.cf`
 * (decoded with a Schema, and optional outside the edge); the colo's city
 * and country come from a bundled JSON list of data centers.
 */

import { Effect, Layer, Option, Record, Schema, SchemaIssue } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import * as Worker from "@mikepage/flareosaur/workers/worker"
import data from "./_data/colos.json" with { type: "json" }

// --- Colo data --------------------------------------------------------------

interface Colo {
  readonly code: string
  readonly city: string
  readonly country: string
  readonly cca2: string
  readonly region: string
  readonly lat?: number
  readonly lon?: number
}

// Cloudflare data centers by IATA code, bundled into the Worker.
const COLOS: Record<string, Omit<Colo, "code">> = data
const colos: ReadonlyArray<Colo> = Object.entries(COLOS).map(([code, c]) => ({ code, ...c }))
const REGIONS = [...new Set(colos.map((c) => c.region))].sort()

const findColo = (code: string): Option.Option<Colo> =>
  Option.map(Record.get(COLOS, code.toUpperCase()), (c) => ({ code: code.toUpperCase(), ...c }))

interface Point {
  readonly lat: number
  readonly lon: number
}

// Great-circle distance in km (haversine).
const distanceKm = (a: Point, b: Point): number => {
  const rad = (d: number) => (d * Math.PI) / 180
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

const pointOf = (c: Colo): Option.Option<Point> =>
  c.lat !== undefined && c.lon !== undefined ? Option.some({ lat: c.lat, lon: c.lon }) : Option.none()

const regionNames = new Intl.DisplayNames(["en"], { type: "region" })
const countryName = (cca2: string): string => {
  try {
    return regionNames.of(cca2) ?? cca2
  } catch {
    return cca2
  }
}

// --- request.cf ---------------------------------------------------------------

// The fields of request.cf this tool reads. Coordinates arrive as strings.
const Cf = Schema.Struct({
  colo: Schema.optional(Schema.String),
  city: Schema.optional(Schema.String),
  region: Schema.optional(Schema.String),
  country: Schema.optional(Schema.String),
  continent: Schema.optional(Schema.String),
  latitude: Schema.optional(Schema.FiniteFromString),
  longitude: Schema.optional(Schema.FiniteFromString),
})
type Cf = typeof Cf.Type

// `cf` lives on the Web Request behind the Effect one. It may be missing
// (Miniflare, tests), so it is an Option.
const requestCf = (request: HttpServerRequest.HttpServerRequest): Option.Option<Cf> =>
  Option.fromNullishOr((request.source as { cf?: unknown }).cf).pipe(Option.flatMap(Schema.decodeUnknownOption(Cf)))

// --- Input --------------------------------------------------------------------

const ColoCode = Schema.String.check(
  Schema.isPattern(/^\s*[A-Za-z]{3}\s*$/, { message: "colo must be a three-letter IATA code" }),
)
const LookupQuery = Schema.Struct({ colo: ColoCode })
const EdgeQuery = Schema.Struct({ colo: Schema.OptionFromOptional(ColoCode) })
const ListQuery = Schema.Struct({
  region: Schema.OptionFromOptional(Schema.Literals(REGIONS as [string, ...Array<string>])),
})

class UnknownColoError extends Schema.TaggedError<UnknownColoError>()("UnknownColoError", { code: Schema.String }) {}

const lookup = (code: string): Effect.Effect<Colo, UnknownColoError> =>
  Option.match(findColo(code.trim()), {
    onSome: Effect.succeed,
    onNone: () => Effect.fail(new UnknownColoError({ code: code.trim().toUpperCase() })),
  })

// "<param>: <message>" for each problem in the query string.
const standard = SchemaIssue.makeFormatterStandardSchemaV1()
const formatIssue = (issue: SchemaIssue.Issue): string =>
  standard(issue).issues
    .map((i) => {
      const path = (i.path ?? []).map((p) => String(typeof p === "object" ? p.key : p)).join(".")
      return path ? `${path}: ${i.message}` : i.message
    })
    .join("; ")
const badRequest = (error: string) => Effect.succeed(HttpServerResponse.jsonUnsafe({ error }, { status: 400 }))
// Bad input and unknown colos are client errors: 400 with a JSON message.
const handleInput = <R>(
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, Schema.SchemaError | UnknownColoError, R>,
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, R> =>
  effect.pipe(
    Effect.catchTags({
      SchemaError: (error) => badRequest(formatIssue(error.issue)),
      UnknownColoError: (error) => badRequest(`unknown colo ${error.code}`),
    }),
  )

// --- Routes -------------------------------------------------------------------

const describeTool = HttpServerResponse.jsonUnsafe({
  name: "cloudflare_colo",
  description:
    "Look up where a Cloudflare data center is by its IATA colo code (the colo in request.cf or /cdn-cgi/trace, e.g. AMS), see which one served this request, or list them all.",
  params: { colo: "Three-letter IATA colo code, e.g. AMS", region: "Region filter for /colos, e.g. Europe" },
  endpoints: {
    "/api?colo=AMS": "the data center's city, country, region and coordinates",
    "/edge": "the data center serving this request (or ?colo=), your location and the distance between them",
    "/colos": "every data center, optionally ?region=",
  },
  example: "/api?colo=AMS",
})

// GET /api?colo=AMS: the original tool's engine.
const api = handleInput(Effect.gen(function*() {
  const { colo } = yield* HttpServerRequest.schemaSearchParams(LookupQuery)
  return HttpServerResponse.jsonUnsafe(yield* lookup(colo))
}))

// GET /edge: which colo served this request, unless ?colo= asks about
// another one, and where Cloudflare places the visitor.
const edge = handleInput(Effect.gen(function*() {
  const query = yield* HttpServerRequest.schemaSearchParams(EdgeQuery)
  const cf = requestCf(yield* HttpServerRequest.HttpServerRequest)
  const servedBy = Option.flatMap(cf, (c) => Option.fromNullishOr(c.colo))
  // A looked-up colo must exist; the serving one may be missing from the list.
  const looked = yield* Effect.transposeOption(Option.map(query.colo, lookup))
  const colo = Option.orElse(looked, () => Option.flatMap(servedBy, findColo))

  const visitor = Option.map(cf, (c) => ({
    city: c.city,
    region: c.region,
    country: c.country,
    countryName: c.country ? countryName(c.country) : undefined,
    continent: c.continent,
    lat: c.latitude,
    lon: c.longitude,
  }))
  const visitorPoint = Option.flatMap(
    cf,
    (c) => c.latitude !== undefined && c.longitude !== undefined ? Option.some({ lat: c.latitude, lon: c.longitude }) : Option.none(),
  )
  const distance = Option.zipWith(Option.flatMap(colo, pointOf), visitorPoint, (a, b) => Math.round(distanceKm(a, b)))

  return HttpServerResponse.jsonUnsafe({
    servedBy: Option.getOrNull(servedBy),
    colo: Option.getOrNull(colo),
    visitor: Option.getOrNull(visitor),
    distanceKm: Option.getOrNull(distance),
  })
}))

// GET /colos?region=Europe: the bundled list.
const list = handleInput(Effect.gen(function*() {
  const { region } = yield* HttpServerRequest.schemaSearchParams(ListQuery)
  const selected = Option.match(region, { onNone: () => colos, onSome: (r) => colos.filter((c) => c.region === r) })
  return HttpServerResponse.jsonUnsafe({ count: selected.length, regions: REGIONS, colos: selected })
}))

const routes = Layer.mergeAll(
  HttpRouter.add("GET", "/", describeTool),
  HttpRouter.add("GET", "/api", api),
  HttpRouter.add("GET", "/edge", edge),
  HttpRouter.add("GET", "/colos", list),
)

export default Worker.make({ fetch: routes })
