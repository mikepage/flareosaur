/**
 * @title SPF validator
 * @difficulty advanced
 * @tags workers, http, dns, schema
 * @group Email
 * @resource {https://www.rfc-editor.org/rfc/rfc7208} RFC 7208: SPF
 * @resource {https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/make-api-requests/dns-json/} Cloudflare: DNS over HTTPS (JSON)
 * @resource {https://effect.website/docs/state-management/ref/} Effect: Ref
 * @check GET / -> 200 "spf-validator" "/api?domain=google.com"
 * @check GET /api -> 400 "error"
 * @check GET /api?domain=localhost -> 400 "invalid domain"
 * @check GET /api?domain=google.com&resolver=nope -> 400 "error"
 * @check GET /api?domain=google.com&resolver=cloudflare -> 200 "\"resolver\":\"cloudflare\"" "\"record\":\"v=spf1" "_spf.google.com" "\"via\":\"include\"" "\"lookups\":"
 * @check GET /api?domain=example.com&record=v%3Dspf1%20ip4%3A192.0.2.1%20-all -> 200 "\"lookups\":0" "\"issues\":[]"
 * @check GET /api?domain=example.com&record=v%3Dspf1%20%2Ball -> 200 "\\\"+all\\\" allows the whole internet"
 * @check GET /api?domain=example.com&record=v%3Dspf1%20%3Fall -> 200 "SPF effectively does nothing"
 * @check GET /api?domain=example.com&record=v%3Dspf1%20-all%20mx -> 200 "should be the last mechanism"
 * @check GET /api?domain=example.com&record=v%3Dspf1%20-all%20exp%3Dexplain.example -> 200 !"should be the last"
 * @check GET /api?domain=example.com&record=v%3Dspf1%20mx -> 200 "Consider adding -all or ~all"
 * @check GET /api?domain=example.com&record=v%3Dspf1%20redirect%3Da.example%20redirect%3Db.example -> 200 "Multiple \\\"redirect\\\" modifiers"
 * @check GET /api?domain=example.com&record=v%3Dspf1%20include%3A%20-all -> 200 "Missing domain for include/redirect"
 * @check GET /api?domain=example.com&record=v%3Dspf1%20ptr%20-all -> 200 "deprecated"
 * @check GET /api?domain=example.com&record=v%3Dspf2%20-all -> 200 "\"version\":null" "Invalid version"
 * @check GET /api?domain=example.com&record=v%3Dspf1%20include%3A%25%7Bi%7D.example%20-all -> 200 "contains SPF macros"
 * @check GET /api?domain=example.com&record=v%3Dspf1%20-all%20redirect%3D_spf.google.com -> 200 "\"lookups\":0" "\\\"redirect\\\" is ignored"
 * @check GET /api?domain=example.com&record=v%3Dspf1%20redirect%3D_spf.google.com -> 200 "\"via\":\"redirect\"" "\"lookups\":1"
 * @check GET /api?domain=example.com&record=v%3Dspf1%20include%3Anope.invalid%20-all -> 200 "DNS lookup failed: Non-existent domain"
 * @check GET /api?domain=example.com&record=v%3Dspf1%20include%3Aa1.invalid%20include%3Aa2.invalid%20include%3Aa3.invalid%20include%3Aa4.invalid%20include%3Aa5.invalid%20include%3Aa6.invalid%20include%3Aa7.invalid%20include%3Aa8.invalid%20include%3Aa9.invalid%20include%3Aa10.invalid%20include%3Aa11.invalid%20include%3Aa12.invalid%20-all -> 200 "\"lookups\":12" "DNS lookup limit exceeded (10)" "Too many DNS lookups: 12"
 *
 * Resolves a domain's SPF record over DNS-over-HTTPS, parses every term and
 * walks each `include` and `redirect` into a tree, counting DNS lookups
 * against RFC 7208's limit of 10 and flagging common mistakes. The walk is
 * a recursive Effect: the lookup count lives in a `Ref`, each TXT query is
 * an `HttpClient` call bounded by `Effect.timeout`, and a failed lookup
 * becomes a note on its node instead of failing the whole request. Pass
 * `record` to check a draft record before you publish it.
 */

import { Duration, Effect, Layer, Ref, Schema, SchemaGetter, SchemaIssue } from "effect"
import { FetchHttpClient, HttpClient, HttpClientResponse, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import * as Worker from "@mikepage/flareosaur/workers/worker"

// --- Input ------------------------------------------------------------------

const RESOLVERS = {
  cloudflare: "https://cloudflare-dns.com/dns-query",
  "cloudflare-security": "https://security.cloudflare-dns.com/dns-query",
  "cloudflare-family": "https://family.cloudflare-dns.com/dns-query",
  google: "https://dns.google/resolve",
} as const
type Resolver = keyof typeof RESOLVERS
const Resolver = Schema.Literals(["cloudflare", "cloudflare-security", "cloudflare-family", "google"])

const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i
// SPF include targets legitimately use underscore-prefixed labels.
const DNS_LABEL = /^_?[a-z0-9]([a-z0-9-_]{0,61}[a-z0-9])?$/i

const hasLabels = (input: string, label: RegExp): boolean => {
  const labels = input.replace(/\.$/, "").split(".")
  return input.length <= 253 && labels.length >= 2 && labels.every((l) => label.test(l))
}

// Strict for user input, looser for names found in records.
const isDomain = (input: string): boolean => hasLabels(input, LABEL)
const isDnsName = (input: string): boolean => hasLabels(input, DNS_LABEL)

const cleanDomain = (input: string): string =>
  input.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/[/?#].*$/, "").replace(/:\d+$/, "")
    .replace(/\.$/, "")

const Domain = Schema.String.pipe(
  Schema.decode({ decode: SchemaGetter.transform(cleanDomain), encode: SchemaGetter.passthrough() }),
).check(Schema.makeFilter(isDomain, { message: "invalid domain" }))

// `domain` and `resolver` as in the original tool. `record` is new: an SPF
// record to evaluate instead of the one published at `domain`.
const Query = Schema.Struct({
  domain: Domain,
  resolver: Schema.optional(Resolver),
  record: Schema.optional(Schema.String.check(Schema.isMaxLength(4096))),
})

// --- DNS over HTTPS ---------------------------------------------------------

const DohResponse = Schema.Struct({
  Status: Schema.Number,
  Answer: Schema.optional(Schema.Array(Schema.Struct({ type: Schema.Number, data: Schema.String }))),
})

const DNS_STATUS: Record<number, string> = {
  1: "Format error",
  2: "Server failure",
  3: "Non-existent domain",
  4: "Not implemented",
  5: "Query refused",
}

// A TXT lookup that did not produce records: the resolver failed, timed out
// or answered with an error RCODE.
class DohError extends Schema.TaggedError<DohError>()("DohError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

const unquoteTxt = (data: string): string =>
  data.split(/"\s+"/).map((s) => s.replace(/^"|"$/g, "")).join("")

// One TXT query: the record strings and how long the resolver took.
const fetchTxt = Effect.fnUntraced(function*(name: string, resolver: Resolver) {
  const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)
  const [elapsed, res] = yield* client.get(RESOLVERS[resolver], {
    urlParams: { name, type: "TXT" },
    headers: { accept: "application/dns-json" },
  }).pipe(
    Effect.flatMap(HttpClientResponse.schemaBodyJson(DohResponse)),
    Effect.timeout(Duration.seconds(5)),
    Effect.timed,
    Effect.mapError((cause) =>
      new DohError({ message: cause._tag === "TimeoutError" ? "DoH query timed out" : `DoH query failed: ${cause.message}`, cause })
    ),
  )
  if (res.Status !== 0) return yield* new DohError({ message: DNS_STATUS[res.Status] ?? `DNS error ${res.Status}` })
  return {
    records: (res.Answer ?? []).filter((a) => a.type === 16).map((a) => unquoteTxt(a.data)),
    ms: Math.round(Duration.toMillis(elapsed)),
  }
})

// --- Parsing (no DNS) -------------------------------------------------------

// RFC 7208 §4.6.4: at most 10 DNS-querying terms per evaluation.
const MAX_LOOKUPS = 10
const LOOKUP_MECHANISMS = new Set(["include", "a", "mx", "ptr", "exists"])

type Qualifier = "+" | "-" | "~" | "?"

interface SpfIssue {
  readonly level: "warn" | "err"
  readonly text: string
}

interface SpfTerm {
  readonly raw: string
  readonly qualifier: Qualifier
  /** Mechanism or modifier name, lowercased. */
  readonly type: string
  readonly value: string
  /** true for `name=value` modifiers (redirect, exp, unknown). */
  readonly modifier: boolean
  /** The node this include/redirect points at, when it was followed. */
  child?: SpfNode
}

interface SpfNode {
  readonly domain: string
  readonly via: "root" | "include" | "redirect"
  record: string | null
  version: string | null
  /** Node-level failure: no record, DNS error, lookup limit, loop. */
  note: string | null
  terms: Array<SpfTerm>
  issues: Array<SpfIssue>
  ms: number
}

// Splits one term into qualifier, name and value.
const parseTerm = (raw: string): SpfTerm => {
  const modifier = raw.match(/^([a-z][a-z0-9_.-]*)=(.*)$/i)
  if (modifier) return { raw, qualifier: "+", type: modifier[1]!.toLowerCase(), value: modifier[2]!, modifier: true }
  const qualifier: Qualifier = /^[+\-~?]/.test(raw) ? raw[0] as Qualifier : "+"
  const term = /^[+\-~?]/.test(raw) ? raw.slice(1) : raw
  const m = term.match(/^([a-z][a-z0-9_.-]*)([:/].*)?$/i)
  if (!m) return { raw, qualifier, type: term.toLowerCase(), value: "", modifier: false }
  const rest = m[2] ?? ""
  return { raw, qualifier, type: m[1]!.toLowerCase(), value: rest.startsWith(":") ? rest.slice(1) : rest, modifier: false }
}

// Parses a record and runs the checks that need no DNS.
const parseSpfRecord = (record: string) => {
  const issues: Array<SpfIssue> = []
  const parts = record.trim().split(/\s+/).filter(Boolean)
  if (!parts[0] || !/^v=spf1$/i.test(parts[0])) {
    issues.push({ level: "err", text: `Invalid version: expected "v=spf1", got "${parts[0] ?? ""}".` })
    return { version: null, terms: [], issues }
  }
  const terms = parts.slice(1).map(parseTerm)
  const mechanisms = terms.filter((t) => !t.modifier)

  for (const t of terms) {
    if (t.type === "ptr") issues.push({ level: "warn", text: "\"ptr\" mechanism is deprecated and slow (RFC 7208 §5.5)." })
    if ((t.type === "include" || t.type === "redirect") && !t.value) {
      issues.push({ level: "err", text: "Missing domain for include/redirect." })
    }
  }

  const all = mechanisms.find((t) => t.type === "all")
  if (all?.qualifier === "+") issues.push({ level: "err", text: "\"+all\" allows the whole internet to send as you." })
  if (all?.qualifier === "?") issues.push({ level: "warn", text: "\"?all\" is neutral — SPF effectively does nothing." })
  if (all && mechanisms.at(-1) !== all) {
    issues.push({ level: "warn", text: "\"all\" should be the last mechanism — anything after it is never evaluated." })
  }

  const redirects = terms.filter((t) => t.type === "redirect")
  if (redirects.length > 1) {
    issues.push({ level: "err", text: "Multiple \"redirect\" modifiers found — only one is allowed (permerror)." })
  }
  if (redirects.length > 0 && all) {
    issues.push({ level: "warn", text: "Both \"redirect\" and \"all\" present — \"redirect\" is ignored when \"all\" is present." })
  }
  if (!all && redirects.length === 0) {
    issues.push({ level: "warn", text: "No \"all\" mechanism found. Consider adding -all or ~all at the end." })
  }

  if (record.length > 255) {
    const chunks = Math.ceil(record.length / 255)
    issues.push({
      level: "warn",
      text: `Record is ${record.length} characters, over the 255-character TXT string limit — it must be split into ${chunks} strings.`,
    })
  }
  return { version: "spf1", terms, issues }
}

// --- The walk ---------------------------------------------------------------

const emptyNode = (domain: string, via: SpfNode["via"], note: string | null = null): SpfNode => ({
  domain,
  via,
  record: null,
  version: null,
  note,
  terms: [],
  issues: [],
  ms: 0,
})

// Walks one record and, depth first, every include and redirect in it. The
// walk stays sequential, like the original: the lookup counter decides which
// include is the 11th, so the order of the queries matters.
const walk = (
  domain: string,
  via: SpfNode["via"],
  ancestors: ReadonlyArray<string>,
  lookups: Ref.Ref<number>,
  resolver: Resolver,
  supplied?: string,
): Effect.Effect<SpfNode, never, HttpClient.HttpClient> =>
  Effect.gen(function*() {
    const node = emptyNode(domain, via)

    let spf: Array<string>
    if (supplied !== undefined) {
      spf = [supplied]
    } else {
      // A failed lookup is a note on this node; the rest of the tree goes on.
      const got = yield* Effect.result(fetchTxt(domain, resolver))
      if (got._tag === "Failure") {
        node.note = `DNS lookup failed: ${got.failure.message}`
        return node
      }
      node.ms = got.success.ms
      const records = got.success.records
      spf = records.filter((r) => /^v=spf1(\s|$)/i.test(r))
      if (spf.length === 0) {
        node.note = records.length > 0 ? `No SPF record found among ${records.length} TXT records` : "No TXT records found"
        return node
      }
      if (spf.length > 1) {
        node.issues.push({ level: "err", text: `${spf.length} SPF records published — that is a permerror; keep exactly one.` })
      }
    }

    const record = spf[0]!
    const parsed = parseSpfRecord(record)
    node.record = record
    node.version = parsed.version
    node.terms = parsed.terms
    node.issues.push(...parsed.issues)

    const hasAll = node.terms.some((t) => !t.modifier && t.type === "all")
    const path = [...ancestors, domain]

    const follow = Effect.fnUntraced(function*(term: SpfTerm, kind: "include" | "redirect") {
      const target = term.value.toLowerCase().replace(/\.$/, "")
      if (!target) return // reported by parseSpfRecord
      const count = yield* Ref.updateAndGet(lookups, (n) => n + 1)
      if (!isDnsName(target)) {
        term.child = emptyNode(target, kind, target.includes("%") ? "contains SPF macros — not expanded" : "not a valid domain name")
      } else if (path.includes(target)) {
        term.child = emptyNode(target, kind, "already in this chain — include loop")
        node.issues.push({ level: "err", text: `Include loop: ${target} includes itself.` })
      } else if (count > MAX_LOOKUPS) {
        term.child = emptyNode(target, kind, `DNS lookup limit exceeded (${MAX_LOOKUPS})`)
      } else {
        term.child = yield* walk(target, kind, path, lookups, resolver)
      }
    })

    for (const term of node.terms) {
      if (term.modifier) continue
      if (term.type === "include") yield* follow(term, "include")
      else if (LOOKUP_MECHANISMS.has(term.type)) yield* Ref.update(lookups, (n) => n + 1)
    }
    // redirect= is applied after all mechanisms, and only without "all".
    const redirect = node.terms.find((t) => t.type === "redirect")
    if (redirect && !hasAll) yield* follow(redirect, "redirect")
    return node
  })

type TaggedIssue = SpfIssue & { readonly domain: string }

const collectIssues = (node: SpfNode, out: Array<TaggedIssue>): void => {
  if (node.note && node.via !== "root") out.push({ level: "err", domain: node.domain, text: node.note })
  for (const i of node.issues) out.push({ ...i, domain: node.domain })
  for (const t of node.terms) if (t.child) collectIssues(t.child, out)
}

const evaluateSpf = Effect.fnUntraced(function*(domain: string, resolver: Resolver, record?: string) {
  const lookups = yield* Ref.make(0)
  const [elapsed, node] = yield* Effect.timed(walk(domain, "root", [], lookups, resolver, record))
  const count = yield* Ref.get(lookups)
  const issues: Array<TaggedIssue> = []
  if (node.note) issues.push({ level: "err", domain, text: node.note })
  collectIssues(node, issues)
  if (count > MAX_LOOKUPS) {
    issues.push({
      level: "err",
      domain,
      text:
        `Too many DNS lookups: ${count} (RFC 7208 allows ${MAX_LOOKUPS}) — receivers return permerror; flatten your includes.`,
    })
  }
  return { domain, resolver, node, lookups: count, queryTime: Math.round(Duration.toMillis(elapsed)), issues }
})

// --- Routes -----------------------------------------------------------------

const api = Effect.gen(function*() {
  const { domain, resolver = "cloudflare", record } = yield* HttpServerRequest.schemaSearchParams(Query)
  return HttpServerResponse.jsonUnsafe(yield* evaluateSpf(domain, resolver, record))
}).pipe(
  Effect.catchTag("SchemaError", (error) =>
    Effect.succeed(
      HttpServerResponse.jsonUnsafe({ error: SchemaIssue.makeFormatterDefault()(error.issue) }, { status: 400 }),
    )),
)

const routes = Layer.mergeAll(
  HttpRouter.add(
    "GET",
    "/",
    HttpServerResponse.jsonUnsafe({
      name: "spf-validator",
      description:
        "Resolve a domain's SPF record, parse every term, recursively walk include/redirect (stopping at the 10-lookup limit), and flag issues. Returns the full tree with per-node errors and issues.",
      params: {
        domain: "Domain to check, e.g. example.com",
        resolver: `DNS-over-HTTPS resolver: ${Object.keys(RESOLVERS).join(", ")} (default cloudflare)`,
        record: "Optional SPF record to evaluate instead of the published one",
      },
      example: "/api?domain=google.com",
    }),
  ),
  HttpRouter.add("GET", "/api", api),
)

export default Worker.make({ layer: FetchHttpClient.layer, fetch: routes })
