// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.
import { Effect, Schema } from "effect"
import { describe, it } from "../testing/mod.ts"
import { assertEquals, assertFailsWithTag, assertStringIncludes } from "../assert/mod.ts"
import * as Toml from "./mod.ts"

describe("parse", () => {
  it.effect("parses tables, arrays and values", () =>
    Effect.gen(function*() {
      const text = `title = "TOML"
[owner]
name = "Bob"
tags = ["a", "b"]
point = { x = 1, y = 2.5 }

[[products]]
name = "Hammer"

[[products]]
name = "Nail"
`
      assertEquals(yield* Toml.parse(text), {
        title: "TOML",
        owner: { name: "Bob", tags: ["a", "b"], point: { x: 1, y: 2.5 } },
        products: [{ name: "Hammer" }, { name: "Nail" }],
      })
    }))

  it.effect("parses integers in every base, special floats and booleans", () =>
    Effect.gen(function*() {
      const value = yield* Toml.parse("a = 0xff\nb = 0o17\nc = 0b101\nd = 1_000\ne = inf\nf = -inf\ng = true\n")
      assertEquals(value, { a: 255, b: 15, c: 5, d: 1000, e: Infinity, f: -Infinity, g: true })
      const nan = yield* Toml.parse("x = nan")
      assertEquals(Number.isNaN(nan.x), true)
    }))

  it.effect("parses date-times and keeps local times as strings", () =>
    Effect.gen(function*() {
      const value = yield* Toml.parse("odt = 1979-05-27T07:32:00Z\nld = 1979-05-27\nlt = 07:32:00\n")
      assertEquals(value, { odt: new Date("1979-05-27T07:32:00Z"), ld: new Date("1979-05-27"), lt: "07:32:00" })
    }))

  it.effect("parses multiline and literal strings and CRLF", () =>
    Effect.gen(function*() {
      assertEquals(yield* Toml.parse('a = """\nline1\nline2"""\nb = \'C:\\path\'\r\nc = "x"\r\n'), {
        a: "line1\nline2",
        b: "C:\\path",
        c: "x",
      })
    }))

  it.effect("parses an empty document", () =>
    Effect.gen(function*() {
      assertEquals(yield* Toml.parse(""), {})
    }))

  it.effect("does not pollute the prototype", () =>
    Effect.gen(function*() {
      const value = yield* Toml.parse("[__proto__]\npolluted = true\n")
      assertEquals(({} as Record<string, unknown>).polluted, undefined)
      assertEquals(Object.keys(value), ["__proto__"])
    }))

  it.effect("fails with a TomlError that points at the line and column", () =>
    Effect.gen(function*() {
      const error = yield* assertFailsWithTag(Toml.parse("foo = 1\nbar ="), "TomlError")
      assertEquals(error.kind, "Parse")
      assertStringIncludes(error.message, "line 2, column 5")
      const unterminated = yield* assertFailsWithTag(Toml.parse("foo = 1\nbar = 'foo\nbaz=1"), "TomlError")
      assertStringIncludes(unterminated.message, "line 2, column 10")
    }))

  it.effect("fails on bare values, EOL in single-line strings and invalid whitespace", () =>
    Effect.gen(function*() {
      const bare = yield* assertFailsWithTag(Toml.parse("[t]\nfoo = BAR\n"), "TomlError")
      assertStringIncludes(bare.message, "line 2, column 6")
      yield* assertFailsWithTag(Toml.parse("bad = 'first\n'\n"), "TomlError")
      yield* assertFailsWithTag(Toml.parse("\u3000foo = \"bar\"\n"), "TomlError")
    }))
})

describe("stringify", () => {
  it.effect("stringifies nested tables and arrays of tables", () =>
    Effect.gen(function*() {
      const text = yield* Toml.stringify({ title: "TOML", owner: { name: "Bob" }, items: [{ a: 1 }, { a: 2 }] })
      assertEquals(text, 'title = "TOML"\n\n[owner]\nname = "Bob"\n\n[[items]]\na = 1\n\n[[items]]\na = 2\n')
    }))

  it.effect("aligns keys when asked", () =>
    Effect.gen(function*() {
      assertEquals(yield* Toml.stringify({ a: 1, long: 2 }, { keyAlignment: true }), "a    = 1\nlong = 2\n")
    }))

  it.effect("round-trips through parse", () =>
    Effect.gen(function*() {
      const value = { s: "a = b # c", n: 1.5, d: new Date("1979-05-27T07:32:00Z"), t: { u: [1, 2] } }
      assertEquals(yield* Toml.parse(yield* Toml.stringify(value)), value)
    }))

  it.effect("fails with a TomlError on values TOML cannot hold", () =>
    Effect.gen(function*() {
      const error = yield* assertFailsWithTag(Toml.stringify({ a: [[null]] }), "TomlError")
      assertEquals(error.kind, "Stringify")
      yield* assertFailsWithTag(Toml.stringify([1] as unknown as Record<string, unknown>), "TomlError")
    }))
})

describe("schema", () => {
  const Config = Schema.Struct({ name: Schema.String, port: Schema.Int })

  it.effect("decodes TOML into a typed value and encodes it back", () =>
    Effect.gen(function*() {
      const config = yield* Schema.decodeEffect(Toml.schema(Config))('name = "api"\nport = 8080\n')
      assertEquals(config, { name: "api", port: 8080 })
      assertEquals(yield* Schema.encodeEffect(Toml.schema(Config))(config), 'name = "api"\nport = 8080\n')
    }))

  it.effect("passes stringify options to the encoder", () =>
    Effect.gen(function*() {
      const codec = Toml.schema(Config, { stringify: { keyAlignment: true } })
      assertEquals(yield* Schema.encodeEffect(codec)({ name: "a", port: 1 }), 'name = "a"\nport = 1\n')
    }))

  it.effect("reports TOML and schema errors as schema issues", () =>
    Effect.gen(function*() {
      yield* assertFailsWithTag(Schema.decodeEffect(Toml.schema(Config))("name = "), "SchemaError")
      yield* assertFailsWithTag(Schema.decodeEffect(Toml.schema(Config))('name = "api"\nport = "x"\n'), "SchemaError")
    }))

  it.effect("UnknownFromToml decodes to an unknown value", () =>
    Effect.gen(function*() {
      assertEquals(yield* Schema.decodeEffect(Toml.UnknownFromToml)("a = [1]"), { a: [1] })
    }))
})
