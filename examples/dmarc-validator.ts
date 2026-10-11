/**
 * @title DMARC validator
 * @difficulty intermediate
 * @tags workers, http, dns, schema
 * @group Email
 * @resource {https://www.rfc-editor.org/rfc/rfc7489} RFC 7489: DMARC
 * @resource {https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/make-api-requests/dns-json/} Cloudflare: DNS over HTTPS (JSON)
 * @resource {https://effect.website/docs/platform/http-client/} Effect: HttpClient
 * @check GET / -> 200 "dmarc-validator" "/api?domain=google.com"
 * @check GET /api -> 400 "error"
 * @check GET /api?domain=not%20a%20domain -> 400 "invalid domain"
 * @check GET /api?domain=google.com&resolver=nope -> 400 "error"
 * @check GET /api?domain=google.com -> 200 "\"domain\":\"google.com\"" "\"resolver\":\"cloudflare\"" "\"policy\":\"reject\"" "Failing emails should be rejected outright" "v=DMARC1 present and first." "\"dnsError\":null" "\"queryTime\":"
 * @check GET /api?domain=https%3A%2F%2F_dmarc.Google.com%2Fpath&resolver=google -> 200 "\"domain\":\"google.com\"" "\"resolver\":\"google\"" "DMARC version: DMARC1" "strict DMARC policy"
 * @check GET /api?domain=no-such-domain-7f3a9c2e.example -> 200 "\"records\":[]" "\"policy\":null" "\"status\":3" "\"dnsError\":null"
 * @check GET /api?domain=dnssec-failed.org -> 200 "\"status\":2" "\"dnsError\":\"Server failure\""
 *
 * Fetches a domain's `_dmarc` TXT record over DNS-over-HTTPS and checks the
 * policy for common mistakes, with a description of every tag. The query is
 * a Schema that cleans what people paste (`https://_dmarc.Example.com/`) and
 * rejects anything that is not a domain; the DoH answer is fetched with
 * `HttpClient`, bounded by `Effect.timeout` and decoded with a Schema.
 */

import { Duration, Effect, Layer, Schema, SchemaGetter, SchemaIssue } from "effect"
import { FetchHttpClient, HttpClient, HttpClientResponse, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import * as Worker from "@mikepage/flareosaur/workers/worker"

// --- Input ------------------------------------------------------------------

// DNS-over-HTTPS resolvers that speak the JSON API (application/dns-json).
const RESOLVERS = {
  cloudflare: { label: "Cloudflare (1.1.1.1)", url: "https://cloudflare-dns.com/dns-query" },
  "cloudflare-security": { label: "Cloudflare Security (1.1.1.2)", url: "https://security.cloudflare-dns.com/dns-query" },
  "cloudflare-family": { label: "Cloudflare Family (1.1.1.3)", url: "https://family.cloudflare-dns.com/dns-query" },
  google: { label: "Google (8.8.8.8)", url: "https://dns.google/resolve" },
} as const
type Resolver = keyof typeof RESOLVERS
const Resolver = Schema.Literals(["cloudflare", "cloudflare-security", "cloudflare-family", "google"])

const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i

// Hostname validation for user input: at least two dot-separated labels.
const isDomain = (input: string): boolean => {
  const labels = input.split(".")
  return input.length <= 253 && labels.length >= 2 && labels.every((l) => LABEL.test(l))
}

// Turns what people paste into a bare domain: lowercase, no scheme, path,
// port, trailing dot or leading `_dmarc.` (the tool adds that itself).
const cleanDomain = (input: string): string => {
  const d = input.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "").replace(/\.$/, "")
  return d.startsWith("_dmarc.") ? d.slice("_dmarc.".length) : d
}

// The domain is cleaned while it is decoded, then checked. A Schema
// transformation keeps the clean-up and the validation in one place.
const Domain = Schema.String.pipe(
  Schema.decode({ decode: SchemaGetter.transform(cleanDomain), encode: SchemaGetter.passthrough() }),
).check(Schema.makeFilter(isDomain, { message: "invalid domain" }))

// The query parameters are the same as the original tool's JSON API.
const Query = Schema.Struct({ domain: Domain, resolver: Schema.optional(Resolver) })

// --- DNS over HTTPS ---------------------------------------------------------

// The part of a DoH JSON answer this tool reads. Unknown keys are ignored.
const DohResponse = Schema.Struct({
  Status: Schema.Number,
  Answer: Schema.optional(Schema.Array(Schema.Struct({ name: Schema.String, type: Schema.Number, data: Schema.String }))),
})

// RCODE to text, for the Status field of a DoH answer.
const DNS_STATUS: Record<number, string> = {
  0: "No error",
  1: "Format error",
  2: "Server failure",
  3: "Non-existent domain",
  4: "Not implemented",
  5: "Query refused",
}

// An upstream failure: the resolver could not be reached, answered with a
// non-2xx status or sent something that is not a DoH answer.
class DohError extends Schema.TaggedError<DohError>()("DohError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

const dohQuery = Effect.fnUntraced(function*(name: string, type: string, resolver: Resolver) {
  const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)
  return yield* client.get(RESOLVERS[resolver].url, {
    urlParams: { name, type },
    headers: { accept: "application/dns-json" },
  }).pipe(
    Effect.flatMap(HttpClientResponse.schemaBodyJson(DohResponse)),
    Effect.timeout(Duration.seconds(5)),
    Effect.mapError((cause) =>
      new DohError({
        message: cause._tag === "TimeoutError" ? "DoH query timed out" : `DoH query failed: ${cause.message}`,
        cause,
      })
    ),
  )
})

// TXT data arrives as one or more quoted strings: `"part1" "part2"`.
const unquoteTxt = (data: string): string =>
  data.split(/"\s+"/).map((s) => s.replace(/^"|"$/g, "")).join("")

// --- Validation -------------------------------------------------------------

interface Check {
  readonly level: "ok" | "warn" | "err"
  readonly text: string
}

const POLICY_VALUES = ["none", "quarantine", "reject"]

const validateDmarc = (record: string): Array<Check> => {
  const checks: Array<Check> = []
  const tags = new Map<string, string>()
  for (const part of record.split(";")) {
    const [k, ...rest] = part.split("=")
    if (k && rest.length) tags.set(k.trim().toLowerCase(), rest.join("=").trim())
  }

  if (!record.trim().toLowerCase().startsWith("v=dmarc1")) checks.push({ level: "err", text: "Record must start with v=DMARC1." })
  else checks.push({ level: "ok", text: "v=DMARC1 present and first." })

  const p = tags.get("p")
  if (!p) checks.push({ level: "err", text: "Required tag p= is missing." })
  else if (!POLICY_VALUES.includes(p)) checks.push({ level: "err", text: `Invalid policy p=${p}.` })
  else if (p === "none") {
    checks.push({
      level: "warn",
      text: "p=none: monitoring only, spoofed mail is still delivered. Move to quarantine or reject once reports look clean.",
    })
  } else checks.push({ level: "ok", text: `Enforcing policy: p=${p}.` })

  const rua = tags.get("rua")
  if (!rua) checks.push({ level: "warn", text: "No rua= aggregate report address — you are flying blind on who sends as this domain." })
  else checks.push({ level: "ok", text: `Aggregate reports to ${rua}.` })

  const pct = tags.get("pct")
  if (pct && pct !== "100") checks.push({ level: "warn", text: `pct=${pct}: policy applies to only ${pct}% of mail.` })

  const sp = tags.get("sp")
  if (sp && !POLICY_VALUES.includes(sp)) checks.push({ level: "err", text: `Invalid subdomain policy sp=${sp}.` })
  if (sp === "none" && p !== "none") checks.push({ level: "warn", text: "sp=none weakens the policy for all subdomains." })

  for (const t of ["adkim", "aspf"]) {
    const v = tags.get(t)
    if (v && !["r", "s"].includes(v)) checks.push({ level: "err", text: `Invalid ${t}=${v} (must be r or s).` })
  }
  return checks
}

const POLICIES: Record<string, string> = {
  none: "No action taken on failing emails (monitoring only)",
  quarantine: "Failing emails should be treated as suspicious (e.g., moved to spam)",
  reject: "Failing emails should be rejected outright",
}

const SUBDOMAIN_POLICIES: Record<string, string> = {
  none: "No action for subdomains",
  quarantine: "Quarantine failing emails from subdomains",
  reject: "Reject failing emails from subdomains",
}

const FAILURE_OPTIONS: Record<string, string> = {
  "0": "Generate failure report if all mechanisms fail",
  "1": "Generate failure report if any mechanism fails",
  d: "Generate failure report on DKIM failure",
  s: "Generate failure report on SPF failure",
}

const alignment = (kind: string, v: string) =>
  v.toLowerCase() === "s"
    ? `${kind} alignment: Strict (exact domain match required)`
    : `${kind} alignment: Relaxed (organizational domain match allowed)`

const TAG_DESCRIPTIONS: Record<string, (v: string) => string> = {
  v: (v) => `DMARC version: ${v}`,
  p: (v) => POLICIES[v.toLowerCase()] ?? `Policy: ${v}`,
  sp: (v) => `Subdomain policy: ${SUBDOMAIN_POLICIES[v.toLowerCase()] ?? v}`,
  rua: (v) => `Aggregate reports sent to: ${v}`,
  ruf: (v) => `Forensic reports sent to: ${v}`,
  pct: (v) => `Policy applies to ${v}% of failing emails`,
  adkim: (v) => alignment("DKIM", v),
  aspf: (v) => alignment("SPF", v),
  fo: (v) => `Failure reporting: ${FAILURE_OPTIONS[v.toLowerCase()] ?? v}`,
  rf: (v) => `Report format: ${v}`,
  ri: (v) => {
    const s = parseInt(v, 10)
    return Number.isNaN(s) ? `Report interval: ${v}` : `Report interval: ${v} seconds (${Math.round(s / 3600)} hours)`
  },
}

const parseTags = (record: string) =>
  record.split(";").map((p) => p.trim()).filter(Boolean).map((part) => {
    const [k = "", ...rest] = part.split("=")
    const tag = k.trim().toLowerCase()
    const value = rest.join("=").trim()
    return { tag, value, description: TAG_DESCRIPTIONS[tag]?.(value) ?? `${tag}: ${value}` }
  })

const policyDescription = (policy: string): string => {
  switch (policy) {
    case "reject":
      return "This domain has a strict DMARC policy. Emails that fail DMARC authentication will be rejected by receiving mail servers. This is the strongest protection against email spoofing."
    case "quarantine":
      return "This domain has a moderate DMARC policy. Emails that fail DMARC authentication may be treated as suspicious and placed in spam/junk folders."
    case "none":
      return "This domain has a monitoring-only DMARC policy. No action is taken on failing emails, but reports may be collected. This provides no protection against spoofing."
    default:
      return "Unknown policy type."
  }
}

// --- The tool ---------------------------------------------------------------

const checkDmarc = Effect.fnUntraced(function*(domain: string, resolver: Resolver) {
  // Effect.timed measures the resolver round trip.
  const [elapsed, res] = yield* Effect.timed(dohQuery(`_dmarc.${domain}`, "TXT", resolver))
  // NXDOMAIN (3) on _dmarc just means there is no record; anything else is a
  // resolver or nameserver problem, reported as such.
  const dnsError = res.Status !== 0 && res.Status !== 3 ? (DNS_STATUS[res.Status] ?? `DNS error: ${res.Status}`) : null
  const records = (res.Answer ?? [])
    .filter((a) => a.type === 16)
    .map((a) => unquoteTxt(a.data))
    .filter((r) => r.toLowerCase().startsWith("v=dmarc"))
    .map((record) => ({ record, checks: validateDmarc(record), tags: parseTags(record) }))
  // Receivers treat a missing p= as none.
  const policy = records[0] ? (records[0].tags.find((t) => t.tag === "p")?.value.toLowerCase() || "none") : null
  return {
    domain,
    records,
    policy,
    policyDescription: policy ? policyDescription(policy) : null,
    resolver,
    queryTime: Math.round(Duration.toMillis(elapsed)),
    status: res.Status,
    dnsError,
  }
})

const api = Effect.gen(function*() {
  const { domain, resolver = "cloudflare" } = yield* HttpServerRequest.schemaSearchParams(Query)
  return HttpServerResponse.jsonUnsafe(yield* checkDmarc(domain, resolver))
}).pipe(
  // Bad input is the client's fault: 400 with the decoding issue.
  Effect.catchTag("SchemaError", (error) =>
    Effect.succeed(
      HttpServerResponse.jsonUnsafe({ error: SchemaIssue.makeFormatterDefault()(error.issue) }, { status: 400 }),
    )),
  // An unreachable or broken resolver is an upstream failure: 502.
  Effect.catchTag("DohError", (error) => Effect.succeed(HttpServerResponse.jsonUnsafe({ error: error.message }, { status: 502 }))),
)

const routes = Layer.mergeAll(
  HttpRouter.add(
    "GET",
    "/",
    HttpServerResponse.jsonUnsafe({
      name: "dmarc-validator",
      description: "Fetch a domain's _dmarc TXT record and validate the DMARC policy, returning per-tag findings.",
      params: {
        domain: "Domain to check, e.g. example.com",
        resolver: `DNS-over-HTTPS resolver: ${Object.keys(RESOLVERS).join(", ")} (default cloudflare)`,
      },
      example: "/api?domain=google.com",
    }),
  ),
  HttpRouter.add("GET", "/api", api),
)

// HttpClient runs on the Workers runtime's own fetch.
export default Worker.make({ layer: FetchHttpClient.layer, fetch: routes })
