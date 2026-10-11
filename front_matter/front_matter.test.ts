// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.
import { Effect, Option, Schema } from "effect"
import { describe, it } from "../testing/mod.ts"
import { assert, assertEquals, assertFailsWithTag, assertFalse, assertStringIncludes } from "../assert/mod.ts"
import * as FrontMatter from "./mod.ts"

describe("test", () => {
  it("recognizes complete front matter in every format", () => {
    assert(FrontMatter.test("---yaml\nname = 'deno'\n---\n"))
    assert(FrontMatter.test("= yaml =\nname = 'deno'\n= yaml =\ndeno is awesome\n"))
    assert(FrontMatter.test("---\nname: deno\n---\n"))
    assert(FrontMatter.test("---toml\nname = 'deno'\n---\n"))
    assert(FrontMatter.test("+++\nname = 'deno'\n+++\n"))
    assert(FrontMatter.test("---json\nname = 'deno'\n---\n"))
    assert(FrontMatter.test("= json =\nname = 'deno'\n= json =\n"))
  })

  it("rejects incomplete front matter and text between horizontal rules", () => {
    for (const text of ["", "---", "---yaml", "= yaml =", "---\n", "---toml\n", "= json =\n", "---\nasdasdasd"]) {
      assertFalse(FrontMatter.test(text), JSON.stringify(text))
    }
    assertFalse(FrontMatter.test("# Project title\n\n---\n\nSome text\n\n---\n\nMIT License"))
  })

  it("only accepts the given formats", () => {
    assert(FrontMatter.test("+++\nname = 'deno'\n+++\n", ["toml"]))
    assertFalse(FrontMatter.test("+++\nname = 'deno'\n+++\n", ["yaml", "json"]))
  })
})

describe("recognize", () => {
  it("returns the format of the opening delimiter", () => {
    assertEquals(FrontMatter.recognize("---\na: 1\n"), Option.some("yaml"))
    assertEquals(FrontMatter.recognize("﻿+++\na = 1\n"), Option.some("toml"))
    assertEquals(FrontMatter.recognize("= json =\n{}"), Option.some("json"))
    assertEquals(FrontMatter.recognize("no front matter"), Option.none())
    assertEquals(FrontMatter.recognize("---\na: 1\n", ["toml"]), Option.none())
  })
})

describe("extract", () => {
  it.effect("extracts YAML front matter", () =>
    Effect.gen(function*() {
      const input = `---
title: Three dashes marks the spot
tags:
  - yaml
  - front-matter
expanded-description: with some --- crazy stuff in it
---
don't break
---
Also this shouldn't be a problem
`
      assertEquals(yield* FrontMatter.extract(input), {
        format: "yaml",
        frontMatter:
          "title: Three dashes marks the spot\ntags:\n  - yaml\n  - front-matter\nexpanded-description: with some --- crazy stuff in it",
        body: "don't break\n---\nAlso this shouldn't be a problem\n",
        attrs: {
          title: "Three dashes marks the spot",
          tags: ["yaml", "front-matter"],
          "expanded-description": "with some --- crazy stuff in it",
        },
      })
      assertEquals((yield* FrontMatter.extract("= yaml =  \nfoo: 0\n---\n")).attrs, { foo: 0 })
    }))

  it.effect("extracts TOML front matter", () =>
    Effect.gen(function*() {
      const result = yield* FrontMatter.extract("+++\ntitle = 'Pluses'\ntags = ['toml']\n+++\nbody\n+++\nmore\n")
      assertEquals(result.format, "toml")
      assertEquals(result.attrs, { title: "Pluses", tags: ["toml"] })
      assertEquals(result.body, "body\n+++\nmore\n")
      assertEquals((yield* FrontMatter.extract("---toml  \nfoo = 0\n--- \n")).attrs, { foo: 0 })
    }))

  it.effect("extracts JSON front matter", () =>
    Effect.gen(function*() {
      const result = yield* FrontMatter.extract('---json\n{"title": "JSON", "n": [1, 2]}\n---\nbody')
      assertEquals(result, { format: "json", frontMatter: '{"title": "JSON", "n": [1, 2]}', body: "body", attrs: { title: "JSON", n: [1, 2] } })
    }))

  it.effect("handles a byte order mark and empty front matter", () =>
    Effect.gen(function*() {
      assertEquals((yield* FrontMatter.extract("﻿---\nfoo: 1\n---\nbody")).attrs, { foo: 1 })
      assertEquals(yield* FrontMatter.extract("---\n   \n---\n"), { format: "yaml", attrs: {}, body: "", frontMatter: "" })
    }))

  it.effect("passes YAML options to the parser", () =>
    Effect.gen(function*() {
      assertEquals((yield* FrontMatter.extract("---\ndate: 2024-08-20\n---\n", { yaml: { schema: "json" } })).attrs, {
        date: "2024-08-20",
      })
    }))

  it.effect("fails on unsupported or malformed front matter", () =>
    Effect.gen(function*() {
      const unsupported = yield* assertFailsWithTag(FrontMatter.extract("no front matter"), "FrontMatterError")
      assertEquals(unsupported.kind, "Unsupported")
      const restricted = yield* assertFailsWithTag(
        FrontMatter.extract("---\na: 1\n---\n", { formats: ["json"] }),
        "FrontMatterError",
      )
      assertEquals(restricted.kind, "Unsupported")
      for (const text of ["---\n", "---\nasdasdasd", "---yaml\nfoo: bar\n---body", "---toml\n"]) {
        const error = yield* assertFailsWithTag(FrontMatter.extract(text), "FrontMatterError")
        assertEquals(error.kind, "Malformed", JSON.stringify(text))
      }
    }))

  it.effect("fails when the front matter does not parse", () =>
    Effect.gen(function*() {
      for (const [text, format] of [["---\na: [1\n---\n", "yaml"], ["+++\na =\n+++\n", "toml"], ["---json\n{a}\n---\n", "json"]]) {
        const error = yield* assertFailsWithTag(FrontMatter.extract(text!), "FrontMatterError")
        assertEquals(error.kind, "Parse")
        assertEquals(error.format, format)
        assertStringIncludes(error.message, `Cannot parse ${format} front matter`)
      }
    }))
})

describe("stringify", () => {
  it.effect("writes front matter that extract reads back", () =>
    Effect.gen(function*() {
      const attrs = { title: "Hi", tags: ["a"] }
      for (const format of FrontMatter.formats) {
        const text = yield* FrontMatter.stringify(attrs, "# Body\n", { format })
        const result = yield* FrontMatter.extract(text)
        assertEquals(result.format, format)
        assertEquals(result.attrs, attrs)
        assertEquals(result.body, "# Body\n")
      }
      assertEquals(yield* FrontMatter.stringify({ a: 1 }, "body"), "---\na: 1\n---\nbody")
    }))

  it.effect("fails on attributes the format cannot hold", () =>
    Effect.gen(function*() {
      const error = yield* assertFailsWithTag(FrontMatter.stringify([1], "", { format: "toml" }), "FrontMatterError")
      assertEquals(error.kind, "Stringify")
      yield* assertFailsWithTag(FrontMatter.stringify(1n, "", { format: "json" }), "FrontMatterError")
    }))
})

describe("schema", () => {
  const Post = Schema.Struct({ title: Schema.String, draft: Schema.Boolean })

  it.effect("decodes typed attributes and the body, and encodes them back", () =>
    Effect.gen(function*() {
      const post = yield* Schema.decodeEffect(FrontMatter.schema(Post))("---\ntitle: Hi\ndraft: false\n---\nbody")
      assertEquals(post, { attrs: { title: "Hi", draft: false }, body: "body" })
      assertEquals(yield* Schema.encodeEffect(FrontMatter.schema(Post))(post), "---\ntitle: Hi\ndraft: false\n---\nbody")
      assertEquals(
        yield* Schema.encodeEffect(FrontMatter.schema(Post, { format: "toml" }))(post),
        '---toml\ntitle = "Hi"\ndraft = false\n---\nbody',
      )
    }))

  it.effect("reports front matter and schema errors as schema issues", () =>
    Effect.gen(function*() {
      yield* assertFailsWithTag(Schema.decodeEffect(FrontMatter.schema(Post))("no front matter"), "SchemaError")
      yield* assertFailsWithTag(Schema.decodeEffect(FrontMatter.schema(Post))("---\ntitle: Hi\n---\n"), "SchemaError")
    }))
})
