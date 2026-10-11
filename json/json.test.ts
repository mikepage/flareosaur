// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.
import { Effect, Schema, Stream } from "effect"
import { describe, it } from "../testing/mod.ts"
import { assertEquals, assertFailsWithTag, assertStringIncludes } from "../assert/mod.ts"
import * as Json from "./mod.ts"

const collect = <A, E>(stream: Stream.Stream<A, E>) => Effect.map(Stream.runCollect(stream), (a) => [...a])

describe("parse", () => {
  it.effect("parses JSON", () =>
    Effect.gen(function*() {
      assertEquals(yield* Json.parse('{"a":[1,true,null]}'), { a: [1, true, null] })
    }))

  it.effect("fails with a JsonError quoting the start of the input", () =>
    Effect.gen(function*() {
      const error = yield* assertFailsWithTag(Json.parse(`{${"foo".repeat(100)}}`), "JsonError")
      assertEquals(error.kind, "Parse")
      assertStringIncludes(error.message, "(parsing: '{foofoofoofoofoofoofoofoofoofo...')")
    }))
})

describe("stringify", () => {
  it.effect("stringifies with optional indentation", () =>
    Effect.gen(function*() {
      assertEquals(yield* Json.stringify({ a: 1 }), '{"a":1}')
      assertEquals(yield* Json.stringify([1], { space: 2 }), "[\n  1\n]")
    }))

  it.effect("fails on values JSON cannot represent", () =>
    Effect.gen(function*() {
      const error = yield* assertFailsWithTag(Json.stringify(1n), "JsonError")
      assertEquals(error.kind, "Stringify")
      yield* assertFailsWithTag(Json.stringify(undefined), "JsonError")
      const cyclic: Record<string, unknown> = {}
      cyclic.self = cyclic
      yield* assertFailsWithTag(Json.stringify(cyclic), "JsonError")
    }))
})

describe("canonicalize", () => {
  it.effect.each([
    [null, "null"],
    [true, "true"],
    ["", '""'],
    ['a"b', '"a\\"b"'],
    ["a\nb", '"a\\nb"'],
    ["\x0f", '"\\u000f"'],
    ["a/b", '"a/b"'],
    ["🦕", '"🦕"'],
    [-0, "0"],
    [1.5, "1.5"],
    [333333333.33333329, "333333333.3333333"],
    [1e21, "1e+21"],
    [1e20, "100000000000000000000"],
    [{}, "{}"],
    [{ z: 1, a: 2 }, '{"a":2,"z":1}'],
    [{ a: 1, A: 2, "1": 3 }, '{"1":3,"A":2,"a":1}'],
    [{ "€": 1, "$": 2 }, '{"$":2,"€":1}'],
    [{ "😀": 1, a: 2 }, '{"a":2,"😀":1}'],
    [[1, [2, { b: 1, a: [] }]], '[1,[2,{"a":[],"b":1}]]'],
  ] as const)("canonicalizes case %#", ([value, expected]) =>
    Effect.gen(function*() {
      assertEquals(yield* Json.canonicalize(value as Schema.Json), expected)
    }))

  it.effect("omits undefined properties", () =>
    Effect.gen(function*() {
      assertEquals(yield* Json.canonicalize({ a: 1, b: undefined, c: 3 } as unknown as Schema.Json), '{"a":1,"c":3}')
    }))

  it.effect("fails on non-finite numbers and cycles", () =>
    Effect.gen(function*() {
      yield* assertFailsWithTag(Json.canonicalize(NaN), "JsonError")
      yield* assertFailsWithTag(Json.canonicalize({ a: Infinity }), "JsonError")
      const cyclic: Record<string, unknown> = {}
      cyclic.self = cyclic
      const error = yield* assertFailsWithTag(Json.canonicalize(cyclic as Schema.Json), "JsonError")
      assertStringIncludes(error.message, "circular")
    }))

  it.effect("canonicalizeToBytes returns the UTF-8 bytes", () =>
    Effect.gen(function*() {
      const bytes = yield* Json.canonicalizeToBytes({ b: "€", a: 1 })
      assertEquals(new TextDecoder().decode(bytes), '{"a":1,"b":"€"}')
      assertEquals(bytes.length, 17)
    }))

  it.effect("canonicalSchema decodes JSON and encodes canonical JSON", () =>
    Effect.gen(function*() {
      const codec = Json.canonicalSchema(Schema.Struct({ b: Schema.Number, a: Schema.Number }))
      assertEquals(yield* Schema.decodeEffect(codec)('{ "b": 2, "a": 1 }'), { b: 2, a: 1 })
      assertEquals(yield* Schema.encodeEffect(codec)({ b: 2, a: 1 }), '{"a":1,"b":2}')
      yield* assertFailsWithTag(Schema.decodeEffect(codec)("{"), "SchemaError")
    }))
})

describe("parseConcatenated", () => {
  it.effect.each([
    [['{"foo": "bar"}'], [{ foo: "bar" }]],
    [[' {"foo": "bar"} '], [{ foo: "bar" }]],
    [['{"foo": "bar"}{"foo": "bar"}'], [{ foo: "bar" }, { foo: "bar" }]],
    [['{"foo": "bar"} {"foo": "bar"}'], [{ foo: "bar" }, { foo: "bar" }]],
    [["0"], [0]],
    [['100 200"foo"'], [100, 200, "foo"]],
    [["1.5[2]true"], [1.5, [2], true]],
    [["nullfalse"], [null, false]],
    [["", '{"foo": "bar"}'], [{ foo: "bar" }]],
    [["{", '"foo": "bar"}'], [{ foo: "bar" }]],
    [['{"foo": "b', 'ar"}'], [{ foo: "bar" }]],
    [['{"foo": "bar"', '}{"foo": "bar"}'], [{ foo: "bar" }, { foo: "bar" }]],
    [["tr", 'ue{"foo": "bar"}'], [true, { foo: "bar" }]],
    [['{"foo": "👪"}{"foo": "👪"}'], [{ foo: "👪" }, { foo: "👪" }]],
    [['"[], {}"'], ["[], {}"]],
    [['"a\\"b"'], ['a"b']],
    [["[ true ]"], [[true]]],
  ] as const)("parses case %#", ([chunks, expected]) =>
    Effect.gen(function*() {
      assertEquals(yield* collect(Stream.fromIterable(chunks).pipe(Json.parseConcatenated)), expected)
    }))

  it.effect("fails on an invalid or truncated value", () =>
    Effect.gen(function*() {
      const error = yield* assertFailsWithTag(collect(Stream.make("truu").pipe(Json.parseConcatenated)), "JsonError")
      assertStringIncludes(error.message, "(parsing: 'truu')")
      const halfway = yield* assertFailsWithTag(
        collect(Stream.make('{"foo": "bar"} {"foo": ').pipe(Json.parseConcatenated)),
        "JsonError",
      )
      assertStringIncludes(halfway.message, `(parsing: ' {"foo": ')`)
    }))
})

describe("JSON text sequences", () => {
  it.effect("parseSequence parses records split across chunks", () =>
    Effect.gen(function*() {
      const chunks = ['\x1E{"a":1}\n\x1E[1,', '2]\n\x1E"x"\n\x1E', "42\n", "\x1E\x1E\n"]
      assertEquals(yield* collect(Stream.fromIterable(chunks).pipe(Json.parseSequence)), [{ a: 1 }, [1, 2], "x", 42])
    }))

  it.effect("parseSequence rejects a possibly truncated number and invalid records", () =>
    Effect.gen(function*() {
      const error = yield* assertFailsWithTag(collect(Stream.make("\x1E1\n\x1E12").pipe(Json.parseSequence)), "JsonError")
      assertStringIncludes(error.message, "truncated")
      yield* assertFailsWithTag(collect(Stream.make('\x1E{"a":\n').pipe(Json.parseSequence)), "JsonError")
    }))

  it.effect("stringifySequence writes records that parseSequence reads back", () =>
    Effect.gen(function*() {
      const values = [{ a: 1 }, "x", 3, null]
      const text = yield* collect(Stream.fromIterable(values).pipe(Json.stringifySequence))
      assertEquals(text, ['\x1E{"a":1}\n', '\x1E"x"\n', "\x1E3\n", "\x1Enull\n"])
      assertEquals(yield* collect(Stream.fromIterable(text).pipe(Json.parseSequence)), values)
    }))

  it.effect("stringifySequence fails on values JSON cannot represent", () =>
    Effect.gen(function*() {
      yield* assertFailsWithTag(collect(Stream.make(1n).pipe(Json.stringifySequence)), "JsonError")
    }))
})

describe("JSON Lines", () => {
  it.effect("parseLines parses lines split across chunks and skips blank lines", () =>
    Effect.gen(function*() {
      const chunks = ['{"a":1}\n{"b"', ":2}\r\n\n", "3"]
      assertEquals(yield* collect(Stream.fromIterable(chunks).pipe(Json.parseLines)), [{ a: 1 }, { b: 2 }, 3])
    }))

  it.effect("parseLines fails with a JsonError", () =>
    Effect.gen(function*() {
      const error = yield* assertFailsWithTag(collect(Stream.make("{oops}\n").pipe(Json.parseLines)), "JsonError")
      assertEquals(error.kind, "Parse")
    }))

  it.effect("stringifyLines writes one value per line", () =>
    Effect.gen(function*() {
      const text = (yield* collect(Stream.make({ a: 1 }, [2]).pipe(Json.stringifyLines))).join("")
      assertEquals(text, '{"a":1}\n[2]\n')
      const error = yield* assertFailsWithTag(collect(Stream.make(1n).pipe(Json.stringifyLines)), "JsonError")
      assertEquals(error.kind, "Stringify")
    }))
})
