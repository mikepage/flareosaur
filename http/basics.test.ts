// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.
// Status, Method, Header, Negotiation, CacheControl and UserAgent.
import { Duration, Effect, Option, Schema } from "effect"
import { Headers, HttpServerRequest, HttpServerResponse } from "effect/http"
import { describe, it } from "../testing/mod.ts"
import { assert, assertEquals, assertFailure, assertFalse, assertSuccess } from "../assert/mod.ts"
import * as CacheControl from "./CacheControl.ts"
import * as Header from "./Header.ts"
import * as Method from "./Method.ts"
import * as Negotiation from "./Negotiation.ts"
import * as Status from "./Status.ts"
import * as UserAgent from "./UserAgent.ts"

describe("Status", () => {
  it("has codes, texts and guards", () => {
    assertEquals(Status.STATUS_CODE.NotFound, 404)
    assertEquals(Status.STATUS_TEXT[Status.STATUS_CODE.InternalServerError], "Internal Server Error")
    assert(Status.isInformationalStatus(101))
    assert(Status.isSuccessfulStatus(204))
    assert(Status.isRedirectStatus(308))
    assert(Status.isClientErrorStatus(418))
    assert(Status.isServerErrorStatus(503))
    assert(Status.isErrorStatus(400))
    assertFalse(Status.isErrorStatus(200))
    assert(Status.isStatus(200))
    assertFalse(Status.isStatus(299))
  })

  it("statusText returns an Option", () => {
    assertEquals(Status.statusText(404), Option.some("Not Found"))
    assertEquals(Status.statusText(299), Option.none())
  })

  it("has Schemas for status codes", () => {
    assert(Schema.is(Status.StatusCode)(200))
    assertFalse(Schema.is(Status.StatusCode)(299))
    assert(Schema.is(Status.ErrorStatus)(404))
    assertFalse(Schema.is(Status.ErrorStatus)(200))
  })
})

describe("Method", () => {
  it("has the registry and a Schema", () => {
    assertEquals(Method.METHOD.Get, "GET")
    assertEquals(Method.METHOD.Label, "LABEL")
    assert(Method.isMethod("PROPFIND"))
    assertFalse(Method.isMethod("get"))
    assert(Schema.is(Method.Method)("BASELINE-CONTROL"))
  })

  it("narrows to Effect's HttpMethod", () => {
    assertEquals(Method.toHttpMethod("get"), Option.some("GET"))
    assertEquals(Method.toHttpMethod("QUERY"), Option.some("QUERY"))
    assertEquals(Method.toHttpMethod("PROPFIND"), Option.none())
  })
})

describe("Header", () => {
  it("has the registry and a Schema", () => {
    assertEquals(Header.HEADER.AIm, "A-IM")
    assertEquals(Header.HEADER.ContentType, "Content-Type")
    assert(Schema.is(Header.Header)("Referer"))
  })

  it("reads headers from Effect and web values", () => {
    const effect = Headers.fromInput({ "content-type": "text/plain" })
    assertEquals(Header.get(effect, Header.HEADER.ContentType), Option.some("text/plain"))
    assertEquals(Header.get(Header.HEADER.ContentType)(new globalThis.Headers({ "Content-Type": "a/b" })), Option.some("a/b"))
    assertEquals(Header.get(new Request("https://x/"), "accept"), Option.none())
  })
})

describe("Negotiation", () => {
  const html = "text/html, application/xhtml+xml, application/xml;q=0.9, image/webp, */*;q=0.8"
  const web = (headers: Record<string, string> = {}) => new Request("https://example.com/", { headers })

  it("lists media types by preference", () => {
    assertEquals(Negotiation.mediaTypes(web({ accept: html })), [
      "text/html",
      "application/xhtml+xml",
      "image/webp",
      "application/xml",
      "*/*",
    ])
    assertEquals(Negotiation.mediaTypes(web()), ["*/*"])
  })

  it("picks the preferred media type", () => {
    assertEquals(Negotiation.accepts(web({ accept: html }), ["text/html", "image/webp"]), Option.some("text/html"))
    assertEquals(
      Negotiation.accepts(web({ accept: "text/html, application/xhtml+xml, application/xml" }), ["application/json"]),
      Option.none(),
    )
    assertEquals(Negotiation.accepts(web(), ["text/html", "image/webp"]), Option.some("text/html"))
    assertEquals(Negotiation.accepts(["image/webp"])(Headers.fromInput({ accept: "image/*" })), Option.some("image/webp"))
    assertEquals(Negotiation.accepts(web(), []), Option.none())
  })

  it("negotiates encodings", () => {
    const req = web({ "accept-encoding": "deflate, gzip;q=1.0, *;q=0.5" })
    assertEquals(Negotiation.encodings(req), ["deflate", "gzip", "*"])
    assertEquals(Negotiation.acceptsEncodings(req, ["gzip", "identity"]), Option.some("gzip"))
    assertEquals(Negotiation.acceptsEncodings(web({ "accept-encoding": "deflate, gzip" }), ["brotli"]), Option.none())
    assertEquals(Negotiation.acceptsEncodings(web({ "accept-encoding": "GZIP" }), ["gzip"]), Option.some("gzip"))
    assertEquals(Negotiation.encodings(web()), ["*"])
  })

  it("negotiates languages", () => {
    const req = web({ "accept-language": "fr-CH, fr;q=0.9, en;q=0.8, de;q=0.7, *;q=0.5" })
    assertEquals(Negotiation.languages(req), ["fr-CH", "fr", "en", "de", "*"])
    assertEquals(Negotiation.acceptsLanguages(req, ["en-gb", "en-us", "en"]), Option.some("en"))
    assertEquals(Negotiation.acceptsLanguages(web({ "accept-language": "en" }), ["zh"]), Option.none())
    assertEquals(Negotiation.acceptsLanguages(web(), ["en-gb", "en"]), Option.some("en-gb"))
    assertEquals(Negotiation.languages(web()), ["*"])
  })

  it.effect("negotiates against the current HttpServerRequest", () =>
    Effect.gen(function*() {
      const request = HttpServerRequest.fromWeb(
        web({ accept: "application/json", "accept-encoding": "br", "accept-language": "nl" }),
      )
      const provide = Effect.provideService(HttpServerRequest.HttpServerRequest, request)
      assertEquals(yield* provide(Negotiation.negotiate(["text/html", "application/json"])), Option.some("application/json"))
      assertEquals(yield* provide(Negotiation.negotiateEncoding(["gzip", "br"])), Option.some("br"))
      assertEquals(yield* provide(Negotiation.negotiateLanguage(["en", "nl"])), Option.some("nl"))
    }))
})

describe("CacheControl", () => {
  it("parses directives", () => {
    assertEquals(CacheControl.parse(null), {})
    assertEquals(CacheControl.parse("   "), {})
    assertEquals(CacheControl.parse("no-store"), { noStore: true })
    assertEquals(CacheControl.parse("max-age=3600"), { maxAge: Duration.seconds(3600) })
    assertEquals(CacheControl.parse("max-age=300, private, must-revalidate"), {
      maxAge: Duration.seconds(300),
      private: true,
      mustRevalidate: true,
    })
    assertEquals(CacheControl.parse('no-cache="foo, bar"'), { noCache: ["foo", "bar"] })
    assertEquals(CacheControl.parse("max-stale"), { maxStale: true })
    assertEquals(CacheControl.parse("max-stale=120"), { maxStale: Duration.seconds(120) })
    assertEquals(CacheControl.parse("NO-STORE, Max-Age=100"), { noStore: true, maxAge: Duration.seconds(100) })
    assertEquals(CacheControl.parse("no-store, unknown=1, no-cache"), { noStore: true, noCache: true })
    assertEquals(CacheControl.parse("max-age=abc, s-maxage=1.5, max-age=100"), {})
  })

  it("formats directives", () => {
    assertEquals(assertSuccess(CacheControl.format({})), "")
    assertEquals(
      assertSuccess(CacheControl.format({ maxAge: Duration.zero, sMaxage: Duration.seconds(100) })),
      "max-age=0, s-maxage=100",
    )
    assertEquals(assertSuccess(CacheControl.format({ noCache: ["foo", "bar"] })), 'no-cache="foo, bar"')
    assertEquals(assertSuccess(CacheControl.format({ maxAge: Duration.millis(1500) })), "max-age=1")
    assertEquals(assertFailure(CacheControl.format({ private: ["bad name"] }))._tag, "CacheControlError")
    assertEquals(assertFailure(CacheControl.format({ maxAge: Duration.infinity }))._tag, "CacheControlError")
  })

  it.effect("round-trips through the Schema codec", () =>
    Effect.gen(function*() {
      const value = "max-age=60, public, immutable"
      const cc = yield* Schema.decodeEffect(CacheControl.CacheControlFromString)(value)
      assertEquals(cc, { maxAge: Duration.minutes(1), public: true, immutable: true })
      assertEquals(yield* Schema.encodeEffect(CacheControl.CacheControlFromString)(cc), value)
    }))

  it.effect("reads and sets the header on HTTP messages", () =>
    Effect.gen(function*() {
      const request = HttpServerRequest.fromWeb(new Request("https://x/", { headers: { "cache-control": "no-cache" } }))
      assertEquals(
        yield* CacheControl.fromRequest.pipe(Effect.provideService(HttpServerRequest.HttpServerRequest, request)),
        { noCache: true },
      )
      const response = yield* HttpServerResponse.text("hi").pipe(CacheControl.set({ noStore: true }))
      assertEquals(Headers.get(response.headers, "cache-control"), Option.some("no-store"))
      const headers = assertSuccess(CacheControl.setHeaders(Headers.empty, { public: true }))
      assertEquals(CacheControl.get(headers), { public: true })
    }))
})

describe("UserAgent", () => {
  const chrome =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.103 Safari/537.36"
  const iphone =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"

  it("parses a desktop browser", () => {
    const ua = UserAgent.parse(chrome)
    assertEquals(ua.ua, chrome)
    assertEquals(ua.browser.name, Option.some("Chrome"))
    assertEquals(ua.browser.version, Option.some("51.0.2704.103"))
    assertEquals(ua.browser.major, Option.some("51"))
    assertEquals(ua.engine.name, Option.some("Blink"))
    assertEquals(ua.os.name, Option.some("macOS"))
    assertEquals(ua.device.type, Option.none())
  })

  it("parses a mobile device", () => {
    const ua = UserAgent.parse(iphone)
    assertEquals(ua.device.type, Option.some("mobile"))
    assertEquals(ua.device.vendor, Option.some("Apple"))
    assertEquals(ua.os.name, Option.some("iOS"))
  })

  it("parses an absent user agent", () => {
    const ua = UserAgent.parse(null)
    assertEquals(ua.ua, "")
    assertEquals(ua.browser.name, Option.none())
    assertEquals(ua.cpu.architecture, Option.none())
  })

  it.effect("reads the request header and decodes with the Schema", () =>
    Effect.gen(function*() {
      const request = HttpServerRequest.fromWeb(new Request("https://x/", { headers: { "user-agent": chrome } }))
      const ua = yield* UserAgent.fromRequest.pipe(Effect.provideService(HttpServerRequest.HttpServerRequest, request))
      assertEquals(ua.browser.name, Option.some("Chrome"))
      const decoded = yield* Schema.decodeEffect(UserAgent.UserAgentFromString)(iphone)
      assertEquals(decoded.os.name, Option.some("iOS"))
      assertEquals(yield* Schema.encodeEffect(UserAgent.UserAgentFromString)(decoded), iphone)
      assertEquals(UserAgent.get(new globalThis.Headers()).ua, "")
    }))
})
