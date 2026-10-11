// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.
import { Effect, Schema } from "effect"
import { describe, it } from "../testing/mod.ts"
import { assertEquals, assertFailsWithTag, assertStrictEquals, assertStringIncludes } from "../assert/mod.ts"
import * as Jsonc from "./mod.ts"

describe("parse", () => {
  it.effect.each([
    [`"aaa"//comment`, "aaa"],
    [`["aaa"//comment\n,"aaa"]`, ["aaa", "aaa"]],
    [`["aaa"//comment\r,"aaa"]`, ["aaa", "aaa"]],
    [`"aaa"/*comment*/`, "aaa"],
    [`100/*comment*/`, 100],
    [`"aaa/*comment*/"`, "aaa/*comment*/"],
    [`"aaa"/*comment\ncomment*/`, "aaa"],
    [`"🦕"`, "🦕"],
    ['"\\u00DC"', "Ü"],
    [`[0,]`, [0]],
    [`0//`, 0],
    ["1.2E-3 // comment", 1.2e-3],
    ['{ "foo": /*hello*/true }', { foo: true }],
    ['{ "": true }', { "": true }],
    ['{ "hello": [], "world": {}, }', { hello: [], world: {} }],
    ["[ 1, 2, ]", [1, 2]],
    ['{"aaa": 0, "aaa": 1}', { aaa: 1 }],
    ['  ["foo\\\\\\"", "bar"]', ['foo\\"', "bar"]],
  ] as const)("parses %s", ([text, expected]) =>
    Effect.gen(function*() {
      assertEquals(yield* Jsonc.parse(text), expected)
    }))

  it.effect("keeps __proto__ as an own property, like JSON.parse", () =>
    Effect.gen(function*() {
      const value = yield* Jsonc.parse('{"__proto__": 100}')
      assertEquals(value, JSON.parse('{"__proto__": 100}'))
      assertStrictEquals(Object.getPrototypeOf(value), Object.prototype)
    }))

  it.effect.each([
    `"aaa"/*`,
    `{"a":0{}`,
    "{,}",
    '{ "bar": 8 "xoo": "foo" }',
    '{ "bar": 8, "foo": }',
    "[,]",
    "[ 1 2, 3 ]",
    "",
    "1,1",
    '["foo\\", "bar"]',
  ])("fails on %s", (text) =>
    Effect.gen(function*() {
      yield* assertFailsWithTag(Jsonc.parse(text), "JsoncError")
    }))

  it.effect("reports the position of the unexpected token", () =>
    Effect.gen(function*() {
      const error = yield* assertFailsWithTag(Jsonc.parse("[]100"), "JsoncError")
      assertStringIncludes(error.message, 'unexpected token "100" in JSONC at position 2')
      const end = yield* assertFailsWithTag(Jsonc.parse('{"a": "b'), "JsoncError")
      assertStringIncludes(end.message, "unexpected end of JSONC input")
    }))

  it.effect("fails on non-string input", () =>
    Effect.gen(function*() {
      yield* assertFailsWithTag(Jsonc.parse(undefined as unknown as string), "JsoncError")
    }))
})

describe("schema", () => {
  const Config = Schema.Struct({ name: Schema.String, port: Schema.Int })

  it.effect("decodes JSONC into a typed value and encodes it as JSON", () =>
    Effect.gen(function*() {
      const config = yield* Schema.decodeEffect(Jsonc.schema(Config))('{\n  // c\n  "name": "api", "port": 8080,\n}')
      assertEquals(config, { name: "api", port: 8080 })
      assertEquals(yield* Schema.encodeEffect(Jsonc.schema(Config))(config), '{"name":"api","port":8080}')
      assertEquals(
        yield* Schema.encodeEffect(Jsonc.schema(Config, { space: 2 }))(config),
        '{\n  "name": "api",\n  "port": 8080\n}',
      )
    }))

  it.effect("reports JSONC and schema errors as schema issues", () =>
    Effect.gen(function*() {
      yield* assertFailsWithTag(Schema.decodeEffect(Jsonc.schema(Config))("{"), "SchemaError")
      yield* assertFailsWithTag(Schema.decodeEffect(Jsonc.schema(Config))('{"name": "a", "port": "x"}'), "SchemaError")
    }))

  it.effect("UnknownFromJsonc decodes to an unknown value", () =>
    Effect.gen(function*() {
      assertEquals(yield* Schema.decodeEffect(Jsonc.UnknownFromJsonc)("[1, /* two */ 2,]"), [1, 2])
    }))
})
