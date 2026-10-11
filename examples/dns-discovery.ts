/**
 * @title DNS discovery: scan a domain in one shot
 * @difficulty advanced
 * @tags workers, http, dns, concurrency, cache
 * @group DNS & domains
 * @resource {https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/make-api-requests/dns-json/} Cloudflare: DoH JSON API
 * @resource {https://crt.sh/} crt.sh: Certificate Transparency search
 * @resource {https://effect.website/docs/concurrency/basic-concurrency/} Effect: concurrency options
 * @check GET / -> 200 "\"name\":\"dns-discovery\"" "/api?domain=example.com"
 * @check GET /api?domain=nope -> 400 "\"error\":"
 * @check GET /api?domain=example.com&resolver=quad9 -> 400 "\"error\":"
 * @check GET /api?domain=https://www.microsoft.com/en-us/&ct=0&resolver=google -> 200 "\"domain\":\"www.microsoft.com\"" "\"resolver\":\"google\"" "\"ct\":null"
 * @check GET /api?domain=microsoft.com&ct=0 -> 200 "\"name\":\"selector1._domainkey\",\"type\":\"CNAME\"" "\"name\":\"_sipfederationtls._tcp\",\"type\":\"SRV\"" "\"name\":\"lyncdiscover\"" "\"name\":\"@\",\"type\":\"MX\""
 * @check GET /api?domain=github.io&ct=0 -> 200 "\"wildcard\":{" "\"targets\":[\""
 * @check GET /api?domain=cloudflare.com&ct=0&dnssec=1 -> 200 "\"dnssec\":{\"validated\":true}"
 * @check GET /api?domain=example.com&ct=1 -> 200 "\"ct\":{"
 * @check GET /zone?domain=example.com&ct=0 -> 200 "$ORIGIN example.com." "; Resolver: Cloudflare (1.1.1.1)" "IN\tNS\t" "IN\tTXT\t\"" header:content-disposition~"attachment; filename=\"example.com_"
 * @check GET /zone?domain=nope -> 400
 *
 * Find a domain's apex records, its email-authentication and Microsoft 365
 * setup, and its subdomains, with about a hundred DNS-over-HTTPS probes run
 * twenty at a time with `Effect.forEach`. Names seen on certificates in
 * Certificate Transparency logs (crt.sh) are probed too; that lookup has a
 * timeout and one retry, is cached for an hour with
 * `@mikepage/flareosaur/workers/cache`, and degrades to a note when crt.sh is
 * down instead of failing the scan.
 */

import { Array as Arr, DateTime, Duration, Effect, Layer, Order, Schedule, Schema, SchemaTransformation } from "effect"
import { FetchHttpClient, HttpClient, HttpClientResponse, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import * as Cache from "@mikepage/flareosaur/workers/cache"
import * as Worker from "@mikepage/flareosaur/workers/worker"

// --- What gets probed ---------------------------------------------------------

// Every probe is one DoH query (one subrequest). CNAMEs are not queried on
// their own: resolvers return the CNAME chain in the answer to A/AAAA/TXT,
// even when the target is dangling.
const APEX_TYPES = ["A", "AAAA", "NS", "MX", "SOA", "TXT", "CAA"]
const SUBDOMAINS = ["www", "mail", "smtp", "imap", "pop", "webmail", "autodiscover", "autoconfig", "ftp", "vpn", "remote", "api", "cdn", "blog", "shop", "dev", "staging", "test", "ns1", "ns2", "m", "app", "lyncdiscover", "sip"]
// Microsoft 365 device registration names are CNAME-only; one A query
// surfaces the chain.
const CNAME_ONLY = ["enterpriseregistration", "enterpriseenrollment"]
const DKIM_SELECTORS = ["api", "cf2024-1", "cm", "default", "dk", "dkim", "google", "k1", "k2", "k3", "krs", "m1", "mail", "mailjet", "mailo", "mailru", "mandrill", "ml", "mx", "pic", "resend", "s1", "s2", "selector1", "selector2", "smtpapi", "smtp", "titan1", "transip-a", "transip-b", "transip-c", "x", "zmail", "zoho"]
const EMAIL_TXT = ["_dmarc", "_mta-sts", "_smtp._tls", "_domainkey", "_dkim", "x-transip-mail-auth"]
const SRV = ["_autodiscover._tcp", "_sipfederationtls._tcp", "_sip._tls"]
const WILDCARD_TYPES = ["A", "AAAA", "TXT", "CAA"]
// Cap on names from CT logs (two queries each), to keep one scan inside sane
// subrequest limits.
const CT_MAX = 50
const CONCURRENCY = 20

type Group = "apex" | "email" | "subdomains"

interface Probe {
  /** Relative label: `@`, `www`, `selector1._domainkey` */
  readonly label: string
  readonly type: string
  readonly group: Group
}

const staticProbes = (): Array<Probe> => [
  ...APEX_TYPES.map((type) => ({ label: "@", type, group: "apex" as const })),
  ...EMAIL_TXT.map((label) => ({ label, type: "TXT", group: "email" as const })),
  ...DKIM_SELECTORS.map((s) => ({ label: `${s}._domainkey`, type: "TXT", group: "email" as const })),
  ...SRV.map((label) => ({ label, type: "SRV", group: "email" as const })),
  ...SUBDOMAINS.flatMap((label) => ["A", "AAAA"].map((type) => ({ label, type, group: "subdomains" as const }))),
  ...CNAME_ONLY.map((label) => ({ label, type: "A", group: "subdomains" as const })),
]

// --- Input --------------------------------------------------------------------

const RESOLVERS = {
  cloudflare: { label: "Cloudflare (1.1.1.1)", url: "https://cloudflare-dns.com/dns-query" },
  "cloudflare-security": { label: "Cloudflare Security (1.1.1.2)", url: "https://security.cloudflare-dns.com/dns-query" },
  "cloudflare-family": { label: "Cloudflare Family (1.1.1.3)", url: "https://family.cloudflare-dns.com/dns-query" },
  google: { label: "Google (8.8.8.8)", url: "https://dns.google/resolve" },
} as const
type Resolver = keyof typeof RESOLVERS

// People paste URLs: lowercase, drop the scheme, path, port and trailing dot.
const cleanDomainInput = (input: string): string =>
  input.trim().toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "")
    .replace(/\.$/, "")

const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i
const isDomain = (input: string): boolean => {
  const labels = input.split(".")
  return input.length <= 253 && labels.length >= 2 && labels.every((l) => LABEL.test(l))
}

// The cleaning is part of the Schema, so `https://www.microsoft.com/en-us/`
// decodes to `www.microsoft.com`.
const Domain = Schema.String.pipe(
  Schema.decode(SchemaTransformation.transform({ decode: cleanDomainInput, encode: (s) => s })),
  Schema.check(Schema.makeFilter(isDomain, { expected: "a domain such as example.com" })),
)

// `1`, `true` or `on` switch a flag on; anything else switches it off.
const Flag = Schema.String.pipe(
  Schema.decodeTo(
    Schema.Boolean,
    SchemaTransformation.transform({ decode: (s) => ["1", "true", "on"].includes(s), encode: (b) => (b ? "1" : "0") }),
  ),
)

const DiscoveryParams = Schema.Struct({
  domain: Domain,
  resolver: Schema.optional(Schema.Literals(Object.keys(RESOLVERS) as Array<Resolver>)),
  dnssec: Schema.optional(Flag),
  ct: Schema.optional(Flag),
})

interface Input {
  readonly domain: string
  readonly resolver: Resolver
  readonly dnssec: boolean
  readonly ct: boolean
}

// Usually `HttpServerRequest.schemaSearchParams` is the way to decode a query.
// Here it is not: the router collapses `//` anywhere in the URL, query
// included, so `?domain=https://example.com` would arrive as
// `https:/example.com`. So the query is read from the request's original URL
// and decoded with the same Schema.
const input: Effect.Effect<Input, Schema.SchemaError, HttpServerRequest.HttpServerRequest> = Effect.gen(function*() {
  const request = yield* HttpServerRequest.HttpServerRequest
  const query = Object.fromEntries(new URL(request.originalUrl, "http://localhost").searchParams)
  const p = yield* Schema.decodeUnknownEffect(DiscoveryParams)(query)
  return { domain: p.domain, resolver: p.resolver ?? "cloudflare", dnssec: p.dnssec ?? false, ct: p.ct ?? true }
})

// --- One DoH probe --------------------------------------------------------------

const DohAnswer = Schema.Struct({ name: Schema.String, type: Schema.Number, TTL: Schema.Number, data: Schema.String })
const DohResponse = Schema.Struct({ Status: Schema.Number, AD: Schema.optional(Schema.Boolean), Answer: Schema.optional(Schema.Array(DohAnswer)) })

const TYPE_NAMES: Record<number, string> = { 1: "A", 2: "NS", 5: "CNAME", 6: "SOA", 15: "MX", 16: "TXT", 28: "AAAA", 33: "SRV", 257: "CAA" }
const typeName = (n: number): string => TYPE_NAMES[n] ?? String(n)

interface Row {
  /** Relative label: `@`, `www` */
  readonly name: string
  readonly type: string
  readonly ttl: number
  /** Display value: no trailing dots, TXT unquoted */
  readonly value: string
  /** RFC 1035 presentation value: absolute names with trailing dots, TXT quoted */
  readonly zone: string
}

const noDot = (s: string): string => s.replace(/\.$/, "")
const dot = (s: string): string => (s.endsWith(".") ? s : `${s}.`)
const unquoteTxt = (data: string): string => data.split(/"\s+"/).map((s) => s.replace(/^"|"$/g, "")).join("")

// Quote TXT for a zone file: keep resolver-quoted strings, else split into
// quoted chunks of at most 255 characters.
const zoneTxt = (data: string): string =>
  data.startsWith('"')
    ? data
    : (data.match(/[\s\S]{1,255}/g) ?? [""]).map((c) => `"${c.replace(/(["\\])/g, "\\$1")}"`).join(" ")

const formatValue = (type: string, data: string): { value: string; zone: string } => {
  const p = data.trim().split(/\s+/)
  switch (type) {
    case "CNAME":
    case "NS":
      return { value: noDot(data), zone: dot(data) }
    case "MX":
      return { value: `${p[0]} ${noDot(p[1] ?? "")}`, zone: `${p[0]} ${dot(p[1] ?? "")}` }
    case "SRV":
      return { value: `${p[0]} ${p[1]} ${p[2]} ${noDot(p[3] ?? "")}`, zone: `${p[0]} ${p[1]} ${p[2]} ${dot(p[3] ?? "")}` }
    case "SOA": {
      const rest = p.slice(2).join(" ")
      return { value: `${noDot(p[0] ?? "")} ${noDot(p[1] ?? "")} ${rest}`, zone: `${dot(p[0] ?? "")} ${dot(p[1] ?? "")} ${rest}` }
    }
    case "TXT":
      return { value: unquoteTxt(data), zone: zoneTxt(data) }
    default:
      return { value: data, zone: data }
  }
}

interface Answered {
  readonly probe: Probe
  readonly rows: ReadonlyArray<Row>
  readonly ad: boolean
}

// One probe -> the records at exactly that name: the queried type, or the
// CNAME the name aliases. A probe that fails (timeout, resolver error) just
// finds nothing: one bad name must not sink a scan of a hundred.
const runProbe = (domain: string, probe: Probe, input: Input): Effect.Effect<Answered, never, HttpClient.HttpClient> => {
  const fqdn = probe.label === "@" ? domain : `${probe.label}.${domain}`
  return Effect.gen(function*() {
    const client = yield* HttpClient.HttpClient
    const res = yield* client.get(RESOLVERS[input.resolver].url, {
      urlParams: { name: fqdn, type: probe.type, ...(input.dnssec ? { do: "1" } : {}) },
      headers: { accept: "application/dns-json" },
    }).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(DohResponse)),
      Effect.timeout("5 seconds"),
    )
    const rows = (res.Answer ?? [])
      .filter((a) => noDot(a.name).toLowerCase() === fqdn && (typeName(a.type) === probe.type || a.type === 5))
      .map((a): Row => ({ name: probe.label, type: typeName(a.type), ttl: a.TTL, ...formatValue(typeName(a.type), a.data) }))
    return { probe, rows, ad: res.AD === true }
  }).pipe(Effect.orElseSucceed(() => ({ probe, rows: [], ad: false })))
}

// --- Wildcards ------------------------------------------------------------------

interface Wildcard {
  readonly cname: string | null
  readonly targets: ReadonlyArray<string>
}

// Resolve a random label: anything that answers is a wildcard, and its values
// mark false positives among the other probes.
const detectWildcard = Effect.fnUntraced(function*(input: Input) {
  const label = `wc-probe-${(yield* Effect.sync(() => crypto.randomUUID())).slice(0, 12)}`
  const answers = yield* Effect.forEach(
    WILDCARD_TYPES,
    (type) => runProbe(input.domain, { label, type, group: "subdomains" }, input),
    { concurrency: "unbounded" },
  )
  const rows = answers.flatMap((a) => a.rows)
  if (rows.length === 0) return null
  return {
    cname: rows.find((r) => r.type === "CNAME")?.value ?? null,
    targets: Arr.dedupe(rows.map((r) => r.value)),
  } satisfies Wildcard
})

// --- Certificate Transparency (crt.sh) -------------------------------------------

const CrtShEntries = Schema.Array(Schema.Struct({ name_value: Schema.String, not_after: Schema.String }))
type CrtShEntry = (typeof CrtShEntries.Type)[number]

// What we cache: the parsed result, not crt.sh's (often huge) response.
const CtSummary = Schema.Struct({
  subdomains: Schema.Array(Schema.String),
  totalCerts: Schema.Number,
  activeCerts: Schema.Number,
})

class CrtShError extends Schema.TaggedError<CrtShError>()("CrtShError", {
  message: Schema.String,
  /** Set when crt.sh answered with a 5xx: worth one retry. */
  status: Schema.optional(Schema.Number),
  cause: Schema.optional(Schema.Defect()),
}) {}

/** Unexpired certificates -> unique subdomain labels (no wildcards, no apex, nothing off-domain). */
const subdomainsFromCerts = (
  domain: string,
  entries: ReadonlyArray<CrtShEntry>,
  now: number,
): { subdomains: Array<string>; activeCerts: number } => {
  // crt.sh gives not_after in UTC without a zone suffix.
  const active = entries.filter((e) =>
    Date.parse(/Z$|[+-]\d\d:?\d\d$/.test(e.not_after) ? e.not_after : `${e.not_after}Z`) > now
  )
  const found = new Set<string>()
  for (const e of active) {
    for (const raw of e.name_value.split("\n")) {
      const name = raw.trim().toLowerCase().replace(/\.$/, "")
      if (!name || name.startsWith("*") || !name.endsWith(`.${domain}`)) continue
      const sub = name.slice(0, -(domain.length + 1))
      if (/^[a-z0-9_]([a-z0-9_.-]*[a-z0-9])?$/.test(sub)) found.add(sub)
    }
  }
  return { subdomains: Arr.sort([...found], Order.String), activeCerts: active.length }
}

const CRTSH_TIMEOUT = Duration.seconds(10)

// crt.sh, fetched and summarised as a JSON response so the Cache API can
// store it. It is slow and sheds load with 502/503s, so: a timeout per
// attempt, and one retry on a 5xx (not on a timeout: that would double the wait).
const fetchCtSummary = Effect.fnUntraced(function*(domain: string) {
  const client = yield* HttpClient.HttpClient
  const response = yield* client.get("https://crt.sh/", {
    urlParams: { q: `%.${domain}`, output: "json" },
    headers: { "user-agent": "flareosaur dns-discovery example" },
  }).pipe(
    Effect.timeout(CRTSH_TIMEOUT),
    Effect.mapError((cause) =>
      new CrtShError({
        message: cause._tag === "TimeoutError" ? `crt.sh did not answer within ${Duration.toSeconds(CRTSH_TIMEOUT)}s` : "crt.sh could not be reached",
        cause,
      })
    ),
    Effect.filterOrFail(
      (r) => r.status < 500,
      (r) => new CrtShError({ message: `crt.sh answered HTTP ${r.status}`, status: r.status }),
    ),
    Effect.retry({ times: 1, while: (e) => e.status !== undefined, schedule: Schedule.spaced("200 millis") }),
  )
  if (response.status !== 200) return yield* new CrtShError({ message: `crt.sh answered HTTP ${response.status}` })
  const text = yield* response.text.pipe(
    Effect.timeout(CRTSH_TIMEOUT),
    Effect.mapError((cause) => new CrtShError({ message: "crt.sh response could not be read", cause })),
  )
  const entries = text.trim() === "" ? [] : yield* Schema.decodeUnknownEffect(Schema.fromJsonString(CrtShEntries))(text).pipe(
    Effect.mapError((cause) => new CrtShError({ message: "crt.sh returned an unreadable response", cause })),
  )
  const now = yield* DateTime.now
  const summary = { ...subdomainsFromCerts(domain, entries, DateTime.toEpochMillis(now)), totalCerts: entries.length }
  return Response.json(summary)
})

interface CtResult {
  readonly subdomains: ReadonlyArray<string>
  readonly totalCerts: number
  readonly activeCerts: number
  readonly cached: boolean
  readonly error?: string
}

// Cache.cached serves the summary from caches.default when it can, and
// otherwise runs fetchCtSummary and stores the response for an hour. The key
// is synthetic: it is never fetched, only used to address the entry. Failures
// never reach the client as errors: they come back in `error`.
const ctSubdomains = (domain: string) => {
  const key = new Request(`https://crtsh.cache.flareosaur.invalid/v1/${encodeURIComponent(domain)}`)
  return Cache.cached(key, fetchCtSummary(domain), { maxAge: "1 hour" }).pipe(
    // No usable cache: fall back to crt.sh itself.
    Effect.catchTag("CacheError", () => fetchCtSummary(domain)),
    Effect.flatMap((response) =>
      Effect.map(
        Effect.promise(() => response.json()).pipe(Effect.flatMap(Schema.decodeUnknownEffect(CtSummary)), Effect.orDie),
        (summary): CtResult => ({ ...summary, cached: response.headers.get("x-cache") === "HIT" }),
      )
    ),
    Effect.catchTag("CrtShError", (e) =>
      Effect.succeed<CtResult>({ subdomains: [], totalCerts: 0, activeCerts: 0, cached: false, error: e.message })),
  )
}

// --- The scan -------------------------------------------------------------------

const byNameThenType: Order.Order<Row> = Order.combine(
  Order.mapInput(Order.String, (r: Row) => r.name),
  Order.mapInput(Order.String, (r: Row) => r.type),
)

const discover = Effect.fnUntraced(function*(input: Input) {
  const { domain } = input
  // crt.sh first (it feeds the probe list), with wildcard detection alongside.
  // Effect.timed measures the whole scan.
  const [elapsed, { answered, probes, fromCt, wildcard, ctData }] = yield* Effect.timed(Effect.gen(function*() {
    const ct: Effect.Effect<CtResult | null, never, HttpClient.HttpClient | Worker.ExecutionContext> = input.ct
      ? ctSubdomains(domain)
      : Effect.succeed(null)
    const [ctData, wildcard] = yield* Effect.all([ct, detectWildcard(input)], { concurrency: "unbounded" })
    const probes = staticProbes()
    const known = new Set(probes.map((p) => p.label))
    const fromCt = (ctData?.subdomains ?? []).filter((s) => !known.has(s))
    for (const label of fromCt.slice(0, CT_MAX)) {
      probes.push({ label, type: "A", group: "subdomains" }, { label, type: "AAAA", group: "subdomains" })
    }
    // The fan-out: every probe, at most CONCURRENCY in flight.
    const answered = yield* Effect.forEach(probes, (p) => runProbe(domain, p, input), { concurrency: CONCURRENCY })
    return { answered, probes, fromCt, wildcard, ctData }
  }))

  // Values the random label also resolves to only exist because of the
  // wildcard. Duplicate rows (a CNAME seen from both the A and AAAA probe)
  // are kept once.
  const targets = new Set(wildcard?.targets ?? [])
  const groups: Record<Group, Array<Row>> = { apex: [], email: [], subdomains: [] }
  const seen = new Set<string>()
  for (const { probe, rows } of answered) {
    for (const r of rows) {
      if (probe.label !== "@" && targets.has(r.value)) continue
      const key = `${r.name}|${r.type}|${r.zone}`
      if (seen.has(key)) continue
      seen.add(key)
      groups[probe.group].push(r)
    }
  }
  groups.subdomains = Arr.sort(groups.subdomains, byNameThenType)

  const fetchedCrt = ctData != null && !ctData.cached && ctData.error === undefined
  return {
    domain,
    resolver: input.resolver,
    queryTimeMs: Math.round(Duration.toMillis(elapsed)),
    // DoH queries made (each one a subrequest), plus one when crt.sh was fetched.
    subrequests: probes.length + WILDCARD_TYPES.length + (fetchedCrt ? 1 : 0),
    total: groups.apex.length + groups.email.length + groups.subdomains.length,
    dnssec: input.dnssec ? { validated: answered.some((a) => a.ad) } : null,
    wildcard,
    ct: ctData && {
      discovered: fromCt.length,
      probed: Math.min(fromCt.length, CT_MAX),
      activeCerts: ctData.activeCerts,
      totalCerts: ctData.totalCerts,
      cached: ctData.cached,
      ...(ctData.error === undefined ? {} : { error: ctData.error }),
    },
    ...groups,
  }
})

type Discovery = Effect.Success<ReturnType<typeof discover>>

// --- Zone file export -----------------------------------------------------------

const zoneFile = (r: Discovery, now: string): string => {
  const lines = [
    `; Zone file for ${r.domain}`,
    `; Exported by the flareosaur dns-discovery example on ${now}`,
    `; Resolver: ${RESOLVERS[r.resolver].label}`,
    `; DNSSEC: ${r.dnssec ? (r.dnssec.validated ? "validated (AD bit set)" : "not validated") : "not requested"}`,
    ...(r.wildcard ? [`; Wildcard detected (*.${r.domain}); matching records filtered`] : []),
    "; Discovered by probing common names, not a complete zone transfer",
    ";",
    `$ORIGIN ${r.domain}.`,
    "",
  ]
  for (const row of [...r.apex, ...r.email, ...r.subdomains]) lines.push(`${row.name}\t${row.ttl}\tIN\t${row.type}\t${row.zone}`)
  return lines.join("\n") + "\n"
}

// --- Routes ---------------------------------------------------------------------

const badRequest = (error: string) => HttpServerResponse.jsonUnsafe({ error }, { status: 400 })

const api = Effect.gen(function*() {
  return HttpServerResponse.jsonUnsafe(yield* discover(yield* input))
}).pipe(Effect.catchTag("SchemaError", (e) => Effect.succeed(badRequest(e.message))))

const zone = Effect.gen(function*() {
  const result = yield* discover(yield* input)
  const now = DateTime.formatIso(yield* DateTime.now)
  const stamp = now.replace(/[:.]/g, "-").slice(0, 19)
  return HttpServerResponse.text(zoneFile(result, now), {
    headers: { "content-disposition": `attachment; filename="${result.domain}_${stamp}.txt"` },
  })
}).pipe(Effect.catchTag("SchemaError", (e) => Effect.succeed(badRequest(e.message))))

const about = HttpServerResponse.jsonUnsafe({
  name: "dns-discovery",
  description:
    "Scan a domain for its apex records, email-authentication and Microsoft 365 setup (SPF/DMARC/DKIM/MTA-STS/SRV), and common subdomains in one shot via ~100 DoH probes. Optionally adds subdomains from Certificate Transparency logs (crt.sh), requests DNSSEC validation, and filters wildcard false positives. A discovery snapshot, not a monitor.",
  params: {
    domain: "Domain to scan, e.g. example.com (a pasted URL works too; required)",
    resolver: `DoH resolver, one of ${Object.keys(RESOLVERS).join(", ")} (default cloudflare)`,
    dnssec: "1 = request DNSSEC validation and report the AD bit (default 0)",
    ct: "1 = add subdomains found in Certificate Transparency logs (crt.sh; slow) (default 1)",
  },
  example: "/api?domain=example.com&resolver=cloudflare&dnssec=0&ct=1",
  zone: "/zone?domain=example.com&ct=0 returns the same scan as a zone file",
})

export default Worker.make({
  layer: FetchHttpClient.layer,
  fetch: Layer.mergeAll(
    HttpRouter.add("GET", "/", about),
    HttpRouter.add("GET", "/api", api),
    HttpRouter.add("GET", "/zone", zone),
  ),
})
