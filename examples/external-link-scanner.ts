/**
 * @title External link scanner
 * @difficulty advanced
 * @tags workers, http, concurrency, crawler
 * @group Web
 * @resource {https://effect.website/docs/platform/http-client/} Effect: HttpClient
 * @resource {https://effect.website/docs/concurrency/basic-concurrency/} Effect: concurrency
 * @check GET / -> 200 "external-link-scanner" "/api?url="
 * @check GET /api?url=https%3A%2F%2Fwww.iana.org%2Fhelp%2Fexample-domains&maxPages=1 -> 200 "\"site\":\"https://www.iana.org\"" "\"pagesScanned\":1" "\"domain\":\"icann.org\"" "\"hosts\":[\"pti.icann.org\",\"www.icann.org\"]" "\"suspicious\":false" "\"kind\":\"link\""
 * @check GET /api?url=https://example.com&maxPages=1 -> 200 "\"site\":\"https://example.com\"" "\"pagesScanned\":1" "\"domains\":[]"
 * @check GET /api?url=ftp%3A%2F%2Fexample.com -> 400 "valid http(s) URL"
 * @check GET /api -> 400 "\"error\""
 * @check GET /api?url=example.com&maxPages=0 -> 400 "\"error\""
 * @check GET /api?url=https%3A%2F%2Fexample.com%2Fthis-page-does-not-exist -> 502 "HTTP 404"
 *
 * Crawls a website (pages on the same registrable domain, up to 100) and
 * lists every external link, script, iframe and form target, grouped by
 * destination domain. Domains that look like injected spam are flagged:
 * nonstandard TLDs, raw IPs, punycode hosts, spam keywords, and active
 * content from a flagged domain. Pages are fetched with `HttpClient` and a
 * per-request timeout, a breadth-first level at a time with
 * `Effect.forEach({ concurrency })`, and the crawl is capped so one request
 * stays within the Worker's subrequest budget.
 */

import { Duration, Effect, Layer, Schema, SchemaIssue } from "effect"
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http"
import * as Worker from "@mikepage/flareosaur/workers/worker"

// Limits so a single request can't crawl unbounded or hang forever. Each
// page is one subrequest; on the Workers Free plan anything past 50 fails
// and shows up as a page error.
const MAX_PAGES_CAP = 100
const CONCURRENCY = 4
const TIMEOUT = Duration.seconds(12)

// --- URLs and domains ------------------------------------------------------

/** What people paste, as an http(s) URL; `example.com` means https. */
const normalizeTarget = (raw: string): URL | undefined => {
  if (!raw) return undefined
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`)
    return url.protocol === "http:" || url.protocol === "https:" ? url : undefined
  } catch {
    return undefined
  }
}

// Common second-level registries, so shop.example.co.uk groups under example.co.uk.
const SECOND_LEVEL = new Set(["co", "com", "net", "org", "gov", "ac", "edu", "or", "ne"])

const isIpHost = (hostname: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":")

/** Approximate registrable domain (eTLD+1) without a full public-suffix list. */
const registrableDomain = (hostname: string): string => {
  if (isIpHost(hostname)) return hostname.toLowerCase()
  const labels = hostname.toLowerCase().split(".").filter(Boolean)
  if (labels.length <= 2) return labels.join(".")
  const tld = labels[labels.length - 1]!
  const sld = labels[labels.length - 2]!
  return labels.slice(tld.length === 2 && SECOND_LEVEL.has(sld) ? -3 : -2).join(".")
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ""
  }
}

const sameSite = (url: string, siteDomain: string) => {
  const host = hostOf(url)
  return host !== "" && registrableDomain(host) === siteDomain
}

/** Resolves href against base: an absolute http(s) URL without fragment, or undefined. */
const resolveHttpUrl = (href: string, baseUrl: string): string | undefined => {
  try {
    const u = new URL(href.trim(), baseUrl)
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined
    u.hash = ""
    return u.href
  } catch {
    return undefined
  }
}

/** Canonical key for the visited set. */
const normalizeForVisit = (url: string) => {
  try {
    const u = new URL(url)
    u.hash = ""
    if (u.pathname !== "/" && u.pathname.endsWith("/")) u.pathname = u.pathname.slice(0, -1)
    return u.href
  } catch {
    return url
  }
}

// Generic TLDs from before ICANN's 2013 new-gTLD expansion. With the
// two-letter country codes these are "standard"; newer ones (.dev, .xyz,
// .top, ...) are cheap, loosely policed and heavily abused for spam.
const CLASSIC_GTLDS = new Set([
  "com", "net", "org", "edu", "gov", "mil", "int", "arpa", "info", "biz", "name",
  "pro", "aero", "asia", "cat", "coop", "jobs", "mobi", "museum", "post", "tel", "travel",
])

const tldOf = (domain: string) => domain.toLowerCase().split(".").filter(Boolean).at(-1) ?? ""
const isStandardTld = (tld: string) => /^[a-z]{2}$/.test(tld.toLowerCase()) || CLASSIC_GTLDS.has(tld.toLowerCase())

// --- Extracting references from HTML ----------------------------------------
// No DOM library: the scanner only needs attributes off a fixed set of tags,
// so a few regular expressions over server-rendered HTML do the job.

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", nbsp: " ",
}

/** Minimal HTML-entity decode, enough for attribute values (esp. &amp; in URLs). */
const decodeEntities = (s: string) =>
  s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : m
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? m
  })

/** The attributes of a start tag, with lowercased names. */
const parseAttrs = (attrText: string) => {
  const attrs = new Map<string, string>()
  for (const m of attrText.matchAll(/([^\s=/>"']+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g)) {
    const name = m[1]!.toLowerCase()
    let value = m[2] ?? ""
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'")) value = value.slice(1, -1)
    if (!attrs.has(name)) attrs.set(name, decodeEntities(value))
  }
  return attrs
}

/** Visible text of an element body: tags stripped, entities decoded, whitespace collapsed. */
const innerText = (body: string, max = 120) => {
  const text = decodeEntities(body.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim()
  return text.length <= max ? text : text.slice(0, max) + "…"
}

interface PageRefs {
  anchors: Array<{ url: string; text: string; rel: string }>
  scripts: Array<string>
  iframes: Array<string>
  forms: Array<string>
}

const extractRefs = (rawHtml: string, baseUrl: string): PageRefs => {
  const result: PageRefs = { anchors: [], scripts: [], iframes: [], forms: [] }
  // Drop comments so commented-out tags are never extracted.
  const html = rawHtml.replace(/<!--[\s\S]*?-->/g, "")
  // Anchors as whole elements, so the link text comes along.
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = parseAttrs(m[1]!)
    const abs = resolveHttpUrl(attrs.get("href") ?? "", baseUrl)
    if (attrs.get("href") && abs) result.anchors.push({ url: abs, text: innerText(m[2]!), rel: attrs.get("rel") ?? "" })
  }
  const collect = (tag: string, attr: string, into: Array<string>) => {
    for (const m of html.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, "gi"))) {
      const raw = parseAttrs(m[1]!).get(attr)
      const abs = raw ? resolveHttpUrl(raw, baseUrl) : undefined
      if (abs) into.push(abs)
    }
  }
  collect("script", "src", result.scripts)
  collect("iframe", "src", result.iframes)
  collect("form", "action", result.forms)
  return result
}

// --- The report --------------------------------------------------------------

type RefKind = "link" | "script" | "iframe" | "form"

/** One reference from a scanned page to an external host. */
interface ExternalRef {
  url: string
  host: string
  kind: RefKind
  page: string
  text: string
  rel: string
  nofollow: boolean
}

/** All references to one external registrable domain. */
interface DomainGroup {
  domain: string
  tld: string
  suspicious: boolean
  reasons: Array<string>
  hosts: Array<string>
  pages: Array<string>
  refs: Array<ExternalRef>
}

interface PageResult {
  url: string
  externalRefs: number
  errors: Array<string>
}

interface ScanReport {
  site: string
  startedAt: string
  finishedAt: string
  pagesScanned: number
  externalRefs: number
  suspiciousDomains: number
  domains: Array<DomainGroup>
  pages: Array<PageResult>
}

// Keywords typical of SEO-spam link injections; a hit flags the domain.
const SPAM_KEYWORDS = [
  "casino", "poker", "slot", "betting", "gambl", "togel", "judi", "viagra", "cialis",
  "pharma", "pills", "porn", "xxx", "escort", "adult", "payday", "replica", "essay",
]

const assessDomain = (domain: string, tld: string, hosts: ReadonlyArray<string>, refs: ReadonlyArray<ExternalRef>) => {
  const reasons: Array<string> = []
  if (isIpHost(domain)) reasons.push("raw IP address instead of a domain name")
  else if (!isStandardTld(tld)) reasons.push(`nonstandard TLD .${tld} (new gTLDs are heavily abused for spam and malware)`)
  if (hosts.some((h) => h.split(".").some((label) => label.startsWith("xn--")))) {
    reasons.push("punycode/IDN hostname (possible homograph spoofing)")
  }
  const spamHits = new Set<string>()
  for (const r of refs) {
    const s = `${r.url} ${r.text}`.toLowerCase()
    for (const k of SPAM_KEYWORDS) if (s.includes(k)) spamHits.add(k)
  }
  if (spamHits.size > 0) reasons.push(`SEO-spam keyword${spamHits.size > 1 ? "s" : ""}: ${[...spamHits].join(", ")}`)
  const active = refs.filter((r) => r.kind !== "link")
  if (active.length > 0 && reasons.length > 0) {
    reasons.push(`serves active content (${[...new Set(active.map((r) => r.kind))].join(", ")}) from a flagged domain`)
  }
  return reasons
}

/** Groups refs per registrable domain, flags suspicious ones, worst first. */
const groupByDomain = (refs: ReadonlyArray<ExternalRef>): Array<DomainGroup> => {
  const byDomain = new Map<string, Array<ExternalRef>>()
  for (const ref of refs) {
    const domain = registrableDomain(ref.host)
    byDomain.set(domain, [...(byDomain.get(domain) ?? []), ref])
  }
  const groups = [...byDomain].map(([domain, domainRefs]): DomainGroup => {
    const hosts = [...new Set(domainRefs.map((r) => r.host))].sort()
    const pages = [...new Set(domainRefs.map((r) => r.page))].sort()
    const tld = tldOf(domain)
    const reasons = assessDomain(domain, tld, hosts, domainRefs)
    return { domain, tld, suspicious: reasons.length > 0, reasons, hosts, pages, refs: domainRefs }
  })
  return groups.sort((a, b) =>
    Number(b.suspicious) - Number(a.suspicious) || b.refs.length - a.refs.length || a.domain.localeCompare(b.domain)
  )
}

// --- Fetching and crawling ----------------------------------------------------

/** The start page could not be scanned, so there is no report to give. */
class ScanError extends Schema.TaggedError<ScanError>()("ScanError", {
  message: Schema.String,
}) {}

const HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
}

interface FetchedPage {
  finalUrl: string
  html: string
  error?: string
}

// Fetches one page. A failure here is part of the report (a page error),
// not a failure of the scan, so the effect cannot fail: transport errors,
// timeouts and non-2xx statuses all become `error`.
const fetchPage = (url: string) =>
  Effect.gen(function*() {
    const client = yield* HttpClient.HttpClient
    const res = yield* client.execute(HttpClientRequest.get(url, { headers: HEADERS }))
    if (res.status < 200 || res.status >= 300) return { finalUrl: url, html: "", error: `HTTP ${res.status}` }
    const contentType = res.headers["content-type"] ?? ""
    // Only HTML is worth reading; anything else is skipped unread.
    const html = contentType.includes("html") || contentType === "" ? yield* res.text : ""
    return { finalUrl: res.url || url, html }
  }).pipe(
    Effect.scoped,
    Effect.timeoutOrElse({
      duration: TIMEOUT,
      orElse: () => Effect.succeed({ finalUrl: url, html: "", error: `fetch failed: timed out after ${Duration.toMillis(TIMEOUT)}ms` }),
    }),
    Effect.catch((e) => Effect.succeed({ finalUrl: url, html: "", error: `fetch failed: ${e.message}` })),
  ) satisfies Effect.Effect<FetchedPage, never, HttpClient.HttpClient>

const scanPage = (url: string, siteDomain: string) =>
  Effect.map(fetchPage(url), (page) => {
    const result: PageResult = { url, externalRefs: 0, errors: page.error ? [page.error] : [] }
    const internalLinks: Array<string> = []
    const externalRefs: Array<ExternalRef> = []
    if (page.error || !page.html) return { result, internalLinks, externalRefs }

    const refs = extractRefs(page.html, page.finalUrl)
    const push = (target: string, kind: RefKind, text = "", rel = "") => {
      const host = hostOf(target)
      if (!host) return
      const nofollow = rel.toLowerCase().split(/[\s,]+/).includes("nofollow")
      externalRefs.push({ url: target, host, kind, page: url, text, rel, nofollow })
    }
    for (const a of refs.anchors) {
      if (sameSite(a.url, siteDomain)) internalLinks.push(a.url)
      else push(a.url, "link", a.text, a.rel)
    }
    for (const s of refs.scripts) if (!sameSite(s, siteDomain)) push(s, "script")
    for (const f of refs.iframes) if (!sameSite(f, siteDomain)) push(f, "iframe")
    for (const f of refs.forms) if (!sameSite(f, siteDomain)) push(f, "form")
    result.externalRefs = externalRefs.length
    return { result, internalLinks, externalRefs }
  })

// Breadth first: each level of the crawl is fetched with at most
// CONCURRENCY requests in flight, and the links it finds become the next
// level, until maxPages pages have been fetched or nothing is left.
const scanSite = Effect.fnUntraced(function*(start: URL, maxPages: number) {
  const startedAt = new Date().toISOString()
  const siteDomain = registrableDomain(start.hostname)
  const seen = new Set<string>([normalizeForVisit(start.href)])
  const pages: Array<PageResult> = []
  const refs: Array<ExternalRef> = []

  let frontier = [...seen]
  while (frontier.length > 0 && pages.length < maxPages) {
    const level = frontier.slice(0, maxPages - pages.length)
    const results = yield* Effect.forEach(level, (url) => scanPage(url, siteDomain), { concurrency: CONCURRENCY })
    frontier = []
    for (const { result, internalLinks, externalRefs } of results) {
      pages.push(result)
      refs.push(...externalRefs)
      // Bound the visited set too, so a page with thousands of links can't
      // blow up memory.
      if (seen.size >= maxPages * 5) continue
      for (const link of internalLinks) {
        const key = normalizeForVisit(link)
        if (!seen.has(key)) {
          seen.add(key)
          frontier.push(key)
        }
      }
    }
  }

  // Nothing to report when even the start page failed.
  const first = pages[0]
  if (first && first.errors.length > 0) {
    return yield* new ScanError({ message: `Could not fetch ${first.url}: ${first.errors.join(", ")}` })
  }

  const domains = groupByDomain(refs)
  const report: ScanReport = {
    site: start.origin,
    startedAt,
    finishedAt: new Date().toISOString(),
    pagesScanned: pages.length,
    externalRefs: refs.length,
    suspiciousDomains: domains.filter((d) => d.suspicious).length,
    domains,
    pages,
  }
  return report
})

// --- Routes --------------------------------------------------------------------

// `maxPages` above the cap is clamped to it, like the original tool.
const Query = Schema.Struct({
  url: Schema.Trim.check(
    Schema.makeFilter((raw: string) => normalizeTarget(raw) !== undefined || "Please enter a valid http(s) URL."),
  ),
  maxPages: Schema.optional(Schema.FiniteFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1))),
})

// The query, read from the request URL itself. (The router's own parsed
// search params collapse "//" inside values, which would turn an unencoded
// `?url=https://example.com` into `https:/example.com`.)
const queryParams = HttpServerRequest.HttpServerRequest.pipe(
  Effect.map((request) => Object.fromEntries(new URL(request.url, "http://localhost").searchParams)),
  Effect.flatMap(Schema.decodeUnknownEffect(Query)),
)

const api = Effect.gen(function*() {
  const query = yield* queryParams
  const start = normalizeTarget(query.url)!
  const report = yield* scanSite(start, Math.min(query.maxPages ?? MAX_PAGES_CAP, MAX_PAGES_CAP))
  return HttpServerResponse.jsonUnsafe(report)
}).pipe(
  Effect.catchTags({
    SchemaError: (error) =>
      Effect.succeed(
        HttpServerResponse.jsonUnsafe({ error: SchemaIssue.makeFormatterDefault()(error.issue) }, { status: 400 }),
      ),
    ScanError: (error) => Effect.succeed(HttpServerResponse.jsonUnsafe({ error: error.message }, { status: 502 })),
  }),
)

const describe = HttpServerResponse.jsonUnsafe({
  name: "external-link-scanner",
  description:
    "Crawl a website (same registrable domain, up to 100 pages) and list every external link, script, iframe and form target grouped by destination domain. Flags nonstandard TLDs, raw IPs, punycode hosts, SEO-spam keywords and active content from flagged domains.",
  params: {
    url: "Site to scan, e.g. example.com or https://example.com/blog (required)",
    maxPages: "Pages to crawl, 1-100 (default 100)",
  },
  example: "/api?url=example.com&maxPages=10",
})

const routes = Layer.mergeAll(
  HttpRouter.add("GET", "/", describe),
  HttpRouter.add("GET", "/api", api),
)

export default Worker.make({ layer: FetchHttpClient.layer, fetch: routes })
