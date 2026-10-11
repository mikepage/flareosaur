/**
 * @title RDAP domain lookup
 * @difficulty intermediate
 * @tags workers, http, schema
 * @group DNS & domains
 * @resource {https://www.rfc-editor.org/rfc/rfc9083} RFC 9083: RDAP responses
 * @resource {https://data.iana.org/rdap/dns.json} IANA: RDAP bootstrap registry
 * @resource {https://effect.website/docs/platform/http-client/} Effect: HttpClient
 * @check GET / -> 200 "rdap-lookup" "/api?domain=cloudflare.com"
 * @check GET /api -> 400 "error"
 * @check GET /api?domain=not%20a%20domain -> 400 "invalid domain"
 * @check GET /api?domain=example.invalidtld -> 502 "TLD \\\".invalidtld\\\" is not supported by RDAP"
 * @check GET /api?domain=cloudflare.com -> 200 "\"domain\":\"cloudflare.com\"" "\"rdapServer\":\"https://rdap.verisign.com/com/v1/\"" "\"handle\":\"" "\"ianaId\":\"" "\"registration\":\"" "\"ipv4\":" "\"delegationSigned\":" "\"queryTimeMs\":" !"\"raw\""
 * @check GET /api?domain=https%3A%2F%2FCloudflare.com%2F&raw=1 -> 200 "\"domain\":\"cloudflare.com\"" "\"raw\":{" "\"objectClassName\":\"domain\""
 * @check GET /api?domain=this-domain-should-not-exist-mikepage-7f3a9.com -> 502 "not found in RDAP registry"
 *
 * Looks up a domain's registration data over RDAP, the structured successor
 * to WHOIS: registrar, status, key dates, nameservers and DNSSEC. The RDAP
 * server comes from a bundled copy of the IANA bootstrap registry. The
 * request goes through `HttpClient` with a retry for dropped connections and
 * a timeout, and the registry's answer is decoded with a lenient Schema; every
 * upstream problem is one typed `RdapError`, answered with a 502.
 */

import { Duration, Effect, Layer, Schema, SchemaGetter, SchemaIssue } from "effect"
import { FetchHttpClient, HttpClient, HttpClientResponse, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import * as Worker from "@mikepage/flareosaur/workers/worker"
// IANA RDAP bootstrap (https://data.iana.org/rdap/dns.json), trimmed to
// { server base URL: "space-separated TLDs" }.
import bootstrap from "./_data/rdap-bootstrap.json" with { type: "json" }

// --- Input ------------------------------------------------------------------

const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i

const isDomain = (input: string): boolean => {
  const labels = input.split(".")
  return input.length <= 253 && labels.length >= 2 && labels.every((l) => LABEL.test(l))
}

const cleanDomain = (input: string): string =>
  input.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/[/?#].*$/, "").replace(/:\d+$/, "")
    .replace(/\.$/, "")

const Domain = Schema.String.pipe(
  Schema.decode({ decode: SchemaGetter.transform(cleanDomain), encode: SchemaGetter.passthrough() }),
).check(Schema.makeFilter(isDomain, { message: "invalid domain" }))

// raw=1 (or raw=true) adds the registry's full response.
const Query = Schema.Struct({ domain: Domain, raw: Schema.optional(Schema.String) })

// --- The RDAP response ------------------------------------------------------

// Only the fields the summary reads, all optional: registries differ, and
// one missing field should not fail the lookup. Unknown keys are ignored.
const RdapEntity = Schema.Struct({
  roles: Schema.optional(Schema.Array(Schema.String)),
  publicIds: Schema.optional(Schema.Array(Schema.Struct({ type: Schema.String, identifier: Schema.String }))),
  // jCard: ["vcard", [[name, params, type, value], ...]]
  vcardArray: Schema.optional(Schema.Tuple([Schema.String, Schema.Array(Schema.Array(Schema.Unknown))])),
})

const DsRecord = Schema.Struct({
  keyTag: Schema.Number,
  algorithm: Schema.Number,
  digestType: Schema.Number,
  digest: Schema.String,
})

const RdapDomain = Schema.Struct({
  ldhName: Schema.optional(Schema.String),
  handle: Schema.optional(Schema.String),
  status: Schema.optional(Schema.Array(Schema.String)),
  events: Schema.optional(Schema.Array(Schema.Struct({ eventAction: Schema.String, eventDate: Schema.String }))),
  nameservers: Schema.optional(Schema.Array(Schema.Struct({
    ldhName: Schema.optional(Schema.String),
    ipAddresses: Schema.optional(Schema.Struct({
      v4: Schema.optional(Schema.Array(Schema.String)),
      v6: Schema.optional(Schema.Array(Schema.String)),
    })),
  }))),
  entities: Schema.optional(Schema.Array(RdapEntity)),
  secureDNS: Schema.optional(Schema.Struct({
    delegationSigned: Schema.optional(Schema.Boolean),
    dsData: Schema.optional(Schema.Array(DsRecord)),
  })),
})

// Every way the lookup can fail upstream: no RDAP server for the TLD, the
// domain is not registered, the registry errs, times out or sends junk.
class RdapError extends Schema.TaggedError<RdapError>()("RdapError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

// --- Bootstrap --------------------------------------------------------------

// TLD -> RDAP base URL, built once per isolate from the bundled registry.
const servers = new Map<string, string>(
  Object.entries(bootstrap.servers as Record<string, string>).flatMap(([url, tlds]) =>
    tlds.split(" ").map((tld) => [tld, url] as const)
  ),
)

const EVENT_ACTIONS: Record<string, "registration" | "expiration" | "lastChanged" | "lastUpdateOfRdapDatabase"> = {
  registration: "registration",
  expiration: "expiration",
  "last changed": "lastChanged",
  "last update of rdap database": "lastUpdateOfRdapDatabase",
}

type RdapEntity = typeof RdapEntity.Type

const registrarName = (entity?: RdapEntity): string | null => {
  const fn = entity?.vcardArray?.[1].find((row) => row[0] === "fn")
  return typeof fn?.[3] === "string" && fn[3] ? fn[3] : null
}

const ianaId = (entity?: RdapEntity): string | null =>
  entity?.publicIds?.find((id) => id.type === "IANA Registrar ID")?.identifier || null

// --- The tool ---------------------------------------------------------------

const lookup = Effect.fnUntraced(function*(domain: string, raw: boolean) {
  const tld = domain.slice(domain.lastIndexOf(".") + 1)
  const rdapServer = servers.get(tld)
  if (!rdapServer) {
    return yield* new RdapError({
      message: `TLD ".${tld}" is not supported by RDAP — no endpoint in the IANA bootstrap registry.`,
    })
  }

  // Some registry servers drop idle keep-alive connections; retryTransient
  // retries a failed connection (or a 5xx) once.
  const client = (yield* HttpClient.HttpClient).pipe(HttpClient.retryTransient({ times: 1 }))

  const [elapsed, data] = yield* client.get(`${rdapServer}domain/${domain}`, {
    headers: { accept: "application/rdap+json", "user-agent": "flareosaur rdap-lookup example" },
  }).pipe(
    Effect.flatMap((res) =>
      Effect.gen(function*() {
        if (res.status === 404) return yield* new RdapError({ message: `Domain "${domain}" not found in RDAP registry.` })
        if (res.status < 200 || res.status >= 300) {
          return yield* new RdapError({ message: `RDAP lookup failed with status ${res.status}.` })
        }
        return yield* res.json
      })
    ),
    Effect.timeout(Duration.seconds(10)),
    Effect.timed,
    Effect.mapError((cause) =>
      cause._tag === "RdapError"
        ? cause
        : new RdapError({
          message: cause._tag === "TimeoutError" ? "RDAP lookup timed out." : `RDAP lookup failed: ${cause.message}`,
          cause,
        })
    ),
  )

  // Keep the raw JSON for raw=1; decode the fields the summary needs.
  const rdap = yield* Schema.decodeUnknownEffect(RdapDomain)(data).pipe(
    Effect.mapError((cause) => new RdapError({ message: `Unexpected RDAP response: ${cause.message}`, cause })),
  )

  const events = { registration: null, expiration: null, lastChanged: null, lastUpdateOfRdapDatabase: null } as Record<
    "registration" | "expiration" | "lastChanged" | "lastUpdateOfRdapDatabase",
    string | null
  >
  for (const ev of rdap.events ?? []) {
    const key = EVENT_ACTIONS[ev.eventAction.toLowerCase()]
    if (key && !events[key]) events[key] = ev.eventDate
  }
  const registrar = rdap.entities?.find((e) => e.roles?.includes("registrar"))

  return {
    domain: (rdap.ldhName ?? domain).toLowerCase(),
    handle: rdap.handle || null,
    registrar: registrarName(registrar),
    ianaId: ianaId(registrar),
    status: rdap.status ?? [],
    events,
    nameservers: (rdap.nameservers ?? []).map((ns) => ({
      name: (ns.ldhName ?? "").toLowerCase(),
      ipv4: ns.ipAddresses?.v4 ?? [],
      ipv6: ns.ipAddresses?.v6 ?? [],
    })),
    dnssec: { delegationSigned: rdap.secureDNS?.delegationSigned ?? false, dsData: rdap.secureDNS?.dsData ?? [] },
    rdapServer,
    queryTimeMs: Math.round(Duration.toMillis(elapsed)),
    ...(raw ? { raw: data } : {}),
  }
})

// --- Routes -----------------------------------------------------------------

const api = Effect.gen(function*() {
  const { domain, raw } = yield* HttpServerRequest.schemaSearchParams(Query)
  return HttpServerResponse.jsonUnsafe(yield* lookup(domain, raw === "1" || raw === "true"))
}).pipe(
  Effect.catchTag("SchemaError", (error) =>
    Effect.succeed(
      HttpServerResponse.jsonUnsafe({ error: SchemaIssue.makeFormatterDefault()(error.issue) }, { status: 400 }),
    )),
  Effect.catchTag("RdapError", (error) => Effect.succeed(HttpServerResponse.jsonUnsafe({ error: error.message }, { status: 502 }))),
)

const routes = Layer.mergeAll(
  HttpRouter.add(
    "GET",
    "/",
    HttpServerResponse.jsonUnsafe({
      name: "rdap-lookup",
      description:
        "Look up registration data (RDAP, the structured successor to WHOIS) for a domain via the IANA bootstrap registry: registrar and IANA ID, registry handle, status, key dates, nameservers with glue IPs, DNSSEC delegation and DS records.",
      params: {
        domain: "Domain to look up, e.g. example.com",
        raw: "Set to 1 to include the full RDAP JSON response",
      },
      example: "/api?domain=cloudflare.com",
    }),
  ),
  HttpRouter.add("GET", "/api", api),
)

export default Worker.make({ layer: FetchHttpClient.layer, fetch: routes })
