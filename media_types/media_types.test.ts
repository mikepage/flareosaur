// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.
import { Effect, Option, Schema } from "effect"
import { describe, it } from "../testing/mod.ts"
import { assertEquals, assertFailsWithTag, assertFailure, assertSuccess } from "../assert/mod.ts"
import * as MediaTypes from "./mod.ts"

describe("contentType", () => {
  const fixtures = [
    [" ; charset=UTF-8", undefined],
    [".json", "application/json; charset=UTF-8"],
    ["text/html", "text/html; charset=UTF-8"],
    ["txt", "text/plain; charset=UTF-8"],
    ["text/plain; charset=ISO-8859-1", "text/plain; charset=ISO-8859-1"],
    ["text/plan; charset", undefined],
    ["foo", undefined],
    ["file.json", undefined],
    ["application/foo", "application/foo"],
  ] as const
  it("returns full content types", () => {
    for (const [input, expected] of fixtures) {
      assertEquals(MediaTypes.contentType(input), Option.fromUndefinedOr(expected), input)
    }
  })
})

describe("typeByExtension", () => {
  it("looks up extensions case-insensitively", () => {
    const fixtures = [
      ["js", "text/javascript"],
      [".js", "text/javascript"],
      ["Js", "text/javascript"],
      ["html", "text/html"],
      [".HTML", "text/html"],
      ["file.json", undefined],
      ["foo", undefined],
      [".foo", undefined],
      [".mp4", "video/mp4"],
    ] as const
    for (const [input, expected] of fixtures) {
      assertEquals(MediaTypes.typeByExtension(input), Option.fromUndefinedOr(expected), input)
    }
  })
})

describe("allExtensions / extension", () => {
  it("lists every extension of a type", () => {
    const fixtures: Array<[string, Array<string> | undefined]> = [
      ["text/plain; charset", undefined],
      ["image/gif", ["gif"]],
      ["application/javascript", ["js"]],
      ["text/javascript", ["js", "mjs"]],
      ["text/html; charset=UTF-8", ["html", "htm", "shtml"]],
      ["application/foo", undefined],
    ]
    for (const [input, expected] of fixtures) {
      assertEquals(MediaTypes.allExtensions(input), Option.fromUndefinedOr(expected), input)
    }
  })

  it("returns the preferred extension", () => {
    assertEquals(MediaTypes.extension("image/gif"), Option.some("gif"))
    assertEquals(MediaTypes.extension("text/html; charset=UTF-8"), Option.some("html"))
    assertEquals(MediaTypes.extension("application/foo"), Option.none())
  })
})

describe("getCharset / isCompressible", () => {
  it("returns the charset", () => {
    const fixtures = [
      [";", undefined],
      ["text/plain; charset", undefined],
      ["text/plain", "UTF-8"],
      ["text/html", "UTF-8"],
      ["application/foo", undefined],
      ["application/news-checkgroups", "US-ASCII"],
      ["application/news-checkgroups; charset=UTF-8", "UTF-8"],
    ] as const
    for (const [input, expected] of fixtures) {
      assertEquals(MediaTypes.getCharset(input), Option.fromUndefinedOr(expected), input)
    }
  })

  it("reports compressibility", () => {
    assertEquals(MediaTypes.isCompressible("application/json"), Option.some(true))
    assertEquals(MediaTypes.isCompressible("application/foo"), Option.none())
  })
})

describe("parseMediaType", () => {
  const nameFoo = { name: "foo" }
  const fixtures: Array<[string, string, Record<string, string>]> = [
    [`form-data; name="foo"`, "form-data", nameFoo],
    [` form-data ; name=foo`, "form-data", nameFoo],
    [`FORM-DATA;name="foo"`, "form-data", nameFoo],
    [`form-data; key=value;  blah="value";name="foo" `, "form-data", { key: "value", blah: "value", name: "foo" }],
    [
      `application/x-stuff; title*=us-ascii'en-us'This%20is%20%2A%2A%2Afun%2A%2A%2A`,
      "application/x-stuff",
      { title: "This is ***fun***" },
    ],
    [
      `message/external-body; access-type=URL; URL*0="ftp://";URL*1="cs.utk.edu/pub/moore/bulk-mailer/bulk-mailer.tar"`,
      "message/external-body",
      { "access-type": "URL", url: "ftp://cs.utk.edu/pub/moore/bulk-mailer/bulk-mailer.tar" },
    ],
    [`attachment`, "attachment", {}],
    [`attachment; filename="Here's a semicolon;.html"`, "attachment", { filename: "Here's a semicolon;.html" }],
    [`attachment; filename*=UTF-8''foo-a%cc%88.html`, "attachment", { filename: "foo-a\u0308.html" }],
    [`attachment; filename*0="foo."; filename*1="html"`, "attachment", { filename: "foo.html" }],
    [`form-data; firstname="Брэд"; lastname="Фицпатрик"`, "form-data", { firstname: "Брэд", lastname: "Фицпатрик" }],
  ]
  it("parses types and parameters", () => {
    for (const [input, type, parameters] of fixtures) {
      assertEquals(assertSuccess(MediaTypes.parseMediaType(input)), { type, parameters }, input)
    }
  })

  it("fails on invalid parameters and duplicate keys", () => {
    const invalid = assertFailure(MediaTypes.parseMediaType(`form-data; foo="bar"; baz`))
    assertEquals(invalid._tag, "MediaTypeError")
    assertEquals(invalid.message, `Cannot parse media type: invalid parameter "; baz"`)
    const duplicate = assertFailure(MediaTypes.parseMediaType(`form-data; foo="bar"; foo="baz"`))
    assertEquals(duplicate.message, "Cannot parse media type: duplicate key")
  })
})

describe("formatMediaType", () => {
  it("formats types and parameters", () => {
    const fixtures = [
      ["noslash", { X: "Y" }, "noslash; x=Y"],
      ["attachment", { filename: "数据统计.png" }, "attachment; filename*=utf-8''%E6%95%B0%E6%8D%AE%E7%BB%9F%E8%AE%A1.png"],
      ["foo/BAR", undefined, "foo/bar"],
      ["foo/BAR", { space: "With space" }, `foo/bar; space="With space"`],
      ["foo/BAR", { quote: `With "quote` }, `foo/bar; quote="With \\"quote"`],
      ["foo/bar", { a: "av", b: "bv", c: "cv" }, "foo/bar; a=av; b=bv; c=cv"],
      ["foo", { bar: "" }, `foo; bar=""`],
    ] as const
    for (const [type, params, expected] of fixtures) {
      assertEquals(assertSuccess(MediaTypes.formatMediaType(type, params)), expected)
    }
    assertEquals(assertSuccess(MediaTypes.formatMediaType("foo/bar", [["a", "b"]])), "foo/bar; a=b")
  })

  it("fails on invalid tokens", () => {
    for (const [type, params] of [["/", undefined], ["foo bar/baz", undefined], ["foo/BAR", { "bad attribute": "baz" }]] as const) {
      assertEquals(assertFailure(MediaTypes.formatMediaType(type, params)).kind, "Format")
    }
  })
})

describe("MediaTypeFromString", () => {
  it.effect("decodes and encodes", () =>
    Effect.gen(function*() {
      const value = yield* Schema.decodeEffect(MediaTypes.MediaTypeFromString)("Text/HTML; Charset=UTF-8")
      assertEquals(value, { type: "text/html", parameters: { charset: "UTF-8" } })
      assertEquals(yield* Schema.encodeEffect(MediaTypes.MediaTypeFromString)(value), "text/html; charset=UTF-8")
      yield* assertFailsWithTag(Schema.decodeEffect(MediaTypes.MediaTypeFromString)("a; b"), "SchemaError")
    }))
})
