// Copyright 2026 the flareosaur authors. MIT license.
import { Effect, pipe, Result, Schema } from "effect"
import { describe, it } from "../testing/mod.ts"
import { assert, assertEquals, assertFailsWithTag, assertFailure, assertFalse, assertSuccess } from "../assert/mod.ts"
import * as Html from "./mod.ts"

describe("escape", () => {
  it("escapes &<>\"'", () => {
    assertEquals(Html.escape("&<>'\""), "&amp;&lt;&gt;&#39;&quot;")
  })

  it("leaves other characters alone", () => {
    assertEquals(Html.escape("\xa0þð"), "\xa0þð")
  })
})

describe("unescape", () => {
  it("round-trips with escape", () => {
    assertEquals(Html.unescape(Html.escape("&<>'\"")), "&<>'\"")
  })

  it("unescapes the default named entities", () => {
    assertEquals(Html.unescape("&apos;&nbsp;"), "'\xa0")
    assertEquals(Html.unescape("&thorn;&eth;"), "&thorn;&eth;")
  })

  it("uses a custom entity list, data-first or data-last", () => {
    const entityList = { "&thorn;": "þ", "&eth;": "ð", "&amp": "&", "&amp;": "&" }
    assertEquals(Html.unescape("&thorn;&eth;", { entityList }), "þð")
    assertEquals(pipe("&amp; &amp", Html.unescape({ entityList })), "& &")
  })

  it("unescapes decimal references", () => {
    assertEquals(Html.unescape("&#46;&#046;"), "..")
    assertEquals(Html.unescape("&#1114111;"), "\u{10ffff}")
    assertEquals(Html.unescape("&#1114112;"), "\ufffd")
  })

  it("unescapes hexadecimal references", () => {
    assertEquals(Html.unescape("&#x2e;&#x2E;&#x02E;"), "...")
    assertEquals(Html.unescape("&#x10ffff;"), "\u{10ffff}")
    assertEquals(Html.unescape("&#x110000;"), "\ufffd")
  })
})

describe("StringFromHtml", () => {
  it.effect("decodes escaped text and encodes plain text", () =>
    Effect.gen(function*() {
      assertEquals(yield* Schema.decodeEffect(Html.StringFromHtml)("a &lt; b &amp;&amp; c"), "a < b && c")
      assertEquals(yield* Schema.encodeEffect(Html.StringFromHtml)("<a href='x'>"), "&lt;a href=&#39;x&#39;&gt;")
    }))
})

describe("escapeCss", () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["", ""],
    ["a", "a"],
    ["0", String.raw`\30 `],
    ["123", String.raw`\31 23`],
    ["-123", String.raw`-\31 23`],
    ["a-123", "a-123"],
    ["-", String.raw`\-`],
    ["_", "_"],
    [" ", String.raw`\ `],
    ["\n", String.raw`\a `],
    ["\0", "\ufffd"],
    ["\x7f", String.raw`\7f `],
    ["文字💩", "文字💩"],
    ["<style>\r\n</style>", String.raw`\<style\>\d \a \<\/style\>`],
  ]
  it.effect.each(cases)("escapes %s", ([input, expected]) => Effect.sync(() => assertEquals(Html.escapeCss(input), expected)))
})

describe("escapeJs", () => {
  it("escapes strings for a <script> context", () => {
    assertEquals(assertSuccess(Html.escapeJs("</script>")), String.raw`"\u003c/script>"`)
    assertEquals(assertSuccess(Html.escapeJs("<SCRIPT>")), String.raw`"\u003cSCRIPT>"`)
    assertEquals(assertSuccess(Html.escapeJs("<!-- ")), String.raw`"\u003c!-- "`)
    assertEquals(assertSuccess(Html.escapeJs("\u2028\u2029<>")), String.raw`"\u2028\u2029<>"`)
  })

  it("escapes objects, with indentation", () => {
    assertEquals(
      assertSuccess(Html.escapeJs({ foo: "</script>", bar: 1 }, { space: 2 })),
      '{\n  "foo": "\\u003c/script>",\n  "bar": 1\n}',
    )
  })

  it("fails on values JSON cannot hold", () => {
    assertEquals(assertFailure(Html.escapeJs(1n))._tag, "EscapeJsError")
    assertEquals(assertFailure(Html.escapeJs(undefined))._tag, "EscapeJsError")
    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    assert(Result.isFailure(Html.escapeJs(cycle)))
  })

  it.effect("lifts into an Effect with Effect.fromResult", () =>
    Effect.gen(function*() {
      yield* assertFailsWithTag(Effect.fromResult(Html.escapeJs(() => 1)), "EscapeJsError")
    }))
})

describe("isValidCustomElementName", () => {
  it("rejects reserved names", () => {
    for (const name of ["annotation-xml", "color-profile", "font-face", "missing-glyph"]) {
      assertFalse(Html.isValidCustomElementName(name))
    }
  })

  it("checks the characters", () => {
    assertFalse(Html.isValidCustomElementName("Custom-element"))
    assertFalse(Html.isValidCustomElementName("custom-element@"))
    assertFalse(Html.isValidCustomElementName("custom_element"))
    assertFalse(Html.isValidCustomElementName("custom.element"))
    assert(Html.isValidCustomElementName("custom-1-element"))
    assert(Html.isValidCustomElementName("custom-element"))
    assert(Html.isValidCustomElementName("math-α"))
  })
})

describe("CustomElementName", () => {
  it.effect("decodes valid names and rejects others", () =>
    Effect.gen(function*() {
      const name: Html.CustomElementName = yield* Schema.decodeUnknownEffect(Html.CustomElementName)("my-element")
      assertEquals(name, "my-element")
      yield* assertFailsWithTag(Schema.decodeUnknownEffect(Html.CustomElementName)("div"), "SchemaError")
      assert(Schema.is(Schema.String.check(Html.isCustomElementName()))("x-y"))
    }))
})

describe("html", () => {
  it("joins the template without escaping", () => {
    assertEquals(Html.html`<div>${'<script>alert("XSS")</script>'}</div>`, '<div><script>alert("XSS")</script></div>')
    assertEquals(Html.html`<p>${null}${undefined}${0}${""}</p>`, "<p>0</p>")
  })
})

describe("safeHtml", () => {
  it("escapes interpolated values", () => {
    assertEquals(Html.safeHtml`<div>${"<b>"}</div>`, "<div>&lt;b&gt;</div>")
    assertEquals(Html.safeHtml`<ul>${["<a>", "b"]}</ul>${null}`, "<ul>&lt;a&gt;b</ul>")
  })
})
