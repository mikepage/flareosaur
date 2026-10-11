// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.
// StructuredFields, ETag and SignedCookie.
import { Effect, Option, Redacted, type Result, Schema } from "effect"
import { Headers, HttpServerRequest, HttpServerResponse } from "effect/http"
import { describe, it } from "../testing/mod.ts"
import {
  assert,
  assertEquals,
  assertFailsWithTag,
  assertFailure,
  assertFalse,
  assertMatch,
  assertStringIncludes,
  assertSuccess,
} from "../assert/mod.ts"
import * as ETag from "./Etag.ts"
import * as SignedCookie from "./SignedCookie.ts"
import * as SF from "./StructuredFields.ts"

describe("StructuredFields", () => {
  it("parses items, lists and dictionaries", () => {
    assertEquals(assertSuccess(SF.parseItem("*foo")).value, { type: "token", value: "*foo" })
    assertEquals(assertSuccess(SF.parseItem("42;a=?0")), SF.item(SF.integer(42), [["a", SF.boolean(false)]]))
    assertEquals(assertSuccess(SF.parseItem(":aGVsbG8=:")).value, SF.binary(new TextEncoder().encode("hello")))
    assertEquals(assertSuccess(SF.parseItem("@1659578233")).value, SF.date(new Date(1659578233000)))
    assertEquals(assertSuccess(SF.parseItem(`%"f%c3%bc%c3%bc"`)).value, SF.displayString("füü"))
    const list = assertSuccess(SF.parseList(`sugar, tea, (rum "x");q=0.5`))
    assertEquals(list.length, 3)
    const third = list[2]!
    assert(SF.isInnerList(third))
    assertEquals(third.parameters.get("q"), SF.decimal(0.5))
    assertFalse(SF.isItem(third))
    assertEquals(assertSuccess(SF.parseList("   ")).length, 0)
    const dict = assertSuccess(SF.parseDictionary("*key=1, b, c=(x y)"))
    assertEquals(dict.get("*key"), SF.item(SF.integer(1)))
    assertEquals(dict.get("b"), SF.item(SF.boolean(true)))
    assertEquals(dict.get("c"), SF.innerList([SF.item(SF.token("x")), SF.item(SF.token("y"))]))
  })

  it("fails with a StructuredFieldError on invalid input", () => {
    const cases: Array<[Result.Result<unknown, SF.StructuredFieldError>, string]> = [
      [SF.parseList("1, 2 garbage"), "expected ','"],
      [SF.parseList("(1 2"), "expected SP or ')'"],
      [SF.parseDictionary("a=1 garbage"), "expected ','"],
      [SF.parseItem("42 garbage"), "unexpected character"],
    ]
    for (const [result, text] of cases) {
      const error = assertFailure(result)
      assertEquals(error._tag, "StructuredFieldError")
      assertEquals(error.kind, "Parse")
      assertStringIncludes(error.message, text)
    }
  })

  it("serializes items, lists and dictionaries", () => {
    assertEquals(assertSuccess(SF.serializeItem(SF.item(SF.token("gzip"), [["q", SF.decimal(0.5)]]))), "gzip;q=0.5")
    assertEquals(assertSuccess(SF.serializeItem(SF.item(SF.string(`a "b"`)))), `"a \\"b\\""`)
    assertEquals(
      assertSuccess(SF.serializeList([SF.item(SF.integer(1)), SF.innerList([SF.item(SF.integer(2))], [["a", SF.integer(3)]])])),
      "1, (2);a=3",
    )
    assertEquals(
      assertSuccess(SF.serializeDictionary(new Map([["a", SF.item(SF.boolean(true))], ["b", SF.item(SF.integer(2))]]))),
      "a, b=2",
    )
  })

  it("fails to serialize unrepresentable values", () => {
    assertEquals(assertFailure(SF.serializeItem(SF.item(SF.integer(1e16)))).kind, "Serialize")
    assertEquals(assertFailure(SF.serializeItem(SF.item(SF.token("1abc")))).kind, "Serialize")
    assertEquals(assertFailure(SF.serializeDictionary(new Map([["A", SF.item(SF.integer(1))]]))).kind, "Serialize")
  })

  it.effect("has Schema codecs", () =>
    Effect.gen(function*() {
      const dict = yield* Schema.decodeEffect(SF.DictionaryFromString)(`a=1, b="x";p`)
      assertEquals(dict.get("b"), SF.item(SF.string("x"), [["p", SF.boolean(true)]]))
      assertEquals(yield* Schema.encodeEffect(SF.DictionaryFromString)(dict), `a=1, b="x";p`)
      const list = yield* Schema.decodeEffect(SF.ListFromString)("1, 2")
      assertEquals(yield* Schema.encodeEffect(SF.ListFromString)(list), "1, 2")
      const item = yield* Schema.decodeEffect(SF.ItemFromString)("?1")
      assertEquals(item, SF.item(SF.boolean(true)))
      yield* assertFailsWithTag(Schema.decodeEffect(SF.ItemFromString)("1 2"), "SchemaError")
      assert(Schema.is(SF.Item)(SF.item(SF.integer(1))))
      assertFalse(Schema.is(SF.BareItem)({ type: "integer", value: "1" }))
    }))
})

describe("ETag", () => {
  const strong = { _tag: "Strong", value: "a-YdfmHmj2RiwOVqJupcf3PLK9PuJ" } as const

  it.effect("computes tags from content", () =>
    Effect.gen(function*() {
      assertEquals(yield* ETag.fromEntity(""), { _tag: "Strong", value: "0-47DEQpj8HBSa+/TImW+5JCeuQeR" })
      assertEquals(yield* ETag.fromEntity("hello deno"), strong)
      assertEquals(yield* ETag.fromEntity(new TextEncoder().encode("hello deno")), strong)
      assertEquals((yield* ETag.fromEntity("hello deno", { weak: true }))._tag, "Weak")
      yield* assertFailsWithTag(ETag.fromEntity("x", { algorithm: "NOPE" }), "EtagError")
    }))

  it.effect("computes weak tags from file info", () =>
    Effect.gen(function*() {
      const tag = yield* ETag.fromFileInfo({ size: 1024, mtime: new Date(Date.UTC(96, 1, 2, 3, 4, 5, 6)) })
      assertEquals(tag, Option.some({ _tag: "Weak", value: "400-H0YzXysQPV20qNisAZMuvAEVuHV" } as const))
      assertEquals(yield* ETag.fromFileInfo({ size: 1, mtime: null }), Option.none())
    }))

  it("parses and formats header values", () => {
    assertEquals(ETag.parse(`W/"x"`), Option.some({ _tag: "Weak", value: "x" } as const))
    assertEquals(ETag.parse(`"x"`), Option.some({ _tag: "Strong", value: "x" } as const))
    assertEquals(ETag.parse("x"), Option.none())
    assertEquals(ETag.format({ _tag: "Weak", value: "x" }), `W/"x"`)
  })

  it("compares If-Match and If-None-Match", () => {
    const weak = { _tag: "Weak", value: strong.value } as const
    assertFalse(ETag.ifMatch(`"abcdefg"`, strong))
    assert(ETag.ifMatch(`"abcdefg", "${strong.value}"`, strong))
    assert(ETag.ifMatch("*", strong))
    assertFalse(ETag.ifMatch("*", weak))
    assertFalse(ETag.ifMatch(null, strong))
    assert(ETag.ifNoneMatch(`"abcdefg"`, strong))
    assertFalse(ETag.ifNoneMatch(`W/"${strong.value}"`, strong))
    assertFalse(ETag.ifNoneMatch("*", strong))
    assert(ETag.ifNoneMatch(undefined, strong))
    assertFalse(ETag.ifNoneMatch(strong)(`"${strong.value}"`))
  })

  it("checks request preconditions", () => {
    const req = (headers: Record<string, string>) => new Request("https://x/", { headers })
    assert(ETag.isNotModified(req({ "if-none-match": `"${strong.value}"` }), strong))
    assertFalse(ETag.isNotModified(req({}), strong))
    assert(ETag.isPreconditionFailed(req({ "if-match": `"other"` }), strong))
    assertFalse(ETag.isPreconditionFailed(req({}), strong))
  })

  it.effect("responds with 304 when the client has the tag", () =>
    Effect.gen(function*() {
      const respond = (headers: Record<string, string>) =>
        ETag.respond(HttpServerResponse.text("hello deno"), strong).pipe(
          Effect.provideService(
            HttpServerRequest.HttpServerRequest,
            HttpServerRequest.fromWeb(new Request("https://x/", { headers })),
          ),
        )
      const fresh = yield* respond({})
      assertEquals(fresh.status, 200)
      assertEquals(Headers.get(fresh.headers, "etag"), Option.some(`"${strong.value}"`))
      const cached = yield* respond({ "if-none-match": `W/"${strong.value}"` })
      assertEquals(cached.status, 304)
      assertEquals(Headers.get(cached.headers, "etag"), Option.some(`"${strong.value}"`))
    }))
})

describe("SignedCookie", () => {
  const generate = Effect.promise(() =>
    crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, true, ["sign", "verify"]) as Promise<CryptoKey>
  )

  it.effect("signs and verifies with a key", () =>
    Effect.gen(function*() {
      const key = yield* generate
      for (const value of ["boris", "boris.xenia"]) {
        const signed = yield* SignedCookie.signWith(value, key)
        assertMatch(signed, /\.[0-9a-f]{64}$/)
        assertEquals(yield* SignedCookie.verifyWith(signed, key), Option.some(value))
        assertEquals(yield* SignedCookie.verifyWith(signed.replace(value, "xenia"), key), Option.none())
      }
    }))

  it.effect("rejects malformed values", () =>
    Effect.gen(function*() {
      const key = yield* generate
      for (const bad of [".", "hello.", ".world", "hello.zz", "plain"]) {
        assertEquals(yield* SignedCookie.verifyWith(bad, key), Option.none())
      }
    }))

  it("reads the value without verifying", () => {
    const sig = "37f7481039762eef5cd46669f93c0a3214dfecba7d0cdc0b0dc40036063fb22e"
    assertEquals(SignedCookie.unverifiedValue(`tokyo.${sig}`), "tokyo")
    assertEquals(SignedCookie.unverifiedValue(`tokyo.osaka.${sig}`), "tokyo.osaka")
  })

  it.effect("signs with a secret from the CookieSigner layer", () =>
    Effect.gen(function*() {
      const signed = yield* SignedCookie.sign("user-1")
      assertEquals(yield* SignedCookie.verify(signed), Option.some("user-1"))
      const other = yield* SignedCookie.verify(signed).pipe(
        Effect.provide(SignedCookie.layer(Redacted.make("another secret"))),
      )
      assertEquals(other, Option.none())
      const raw = yield* SignedCookie.verify(signed).pipe(
        Effect.provide(SignedCookie.layer(Redacted.make(new TextEncoder().encode("a secret")))),
      )
      assertEquals(raw, Option.some("user-1"))
    }).pipe(Effect.provide(SignedCookie.layer(Redacted.make("a secret")))))

  it.effect("sets and reads signed cookies on HTTP messages", () =>
    Effect.gen(function*() {
      const key = yield* generate
      const response = yield* HttpServerResponse.text("ok").pipe(
        SignedCookie.setCookie("session", "u42", { path: "/" }),
        Effect.provide(SignedCookie.layerKey(key)),
      )
      const cookie = HttpServerResponse.toWeb(response).headers.get("set-cookie")!
      const pair = cookie.split(";")[0]!
      const read = (header: string) =>
        SignedCookie.getCookie("session").pipe(
          Effect.provide(SignedCookie.layerKey(key)),
          Effect.provideService(
            HttpServerRequest.HttpServerRequest,
            HttpServerRequest.fromWeb(new Request("https://x/", { headers: { cookie: header } })),
          ),
        )
      assertEquals(yield* read(pair), Option.some("u42"))
      assertEquals(yield* read(pair.replace("u42", "u43")), Option.none())
      assertEquals(yield* read("other=1"), Option.none())
    }))

  it.effect("fails with a SignedCookieError when the key cannot sign", () =>
    Effect.gen(function*() {
      const key = yield* Effect.promise(() =>
        crypto.subtle.importKey("raw", new Uint8Array(32), { name: "HMAC", hash: "SHA-256" }, false, ["verify"])
      )
      yield* assertFailsWithTag(SignedCookie.signWith("x", key), "SignedCookieError")
    }))
})
