// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.
import { Config, ConfigProvider, Effect, Layer } from "effect"
import { describe, it } from "../testing/mod.ts"
import { assertEquals, assertFailsWithTag, assertStringIncludes } from "../assert/mod.ts"
import * as Dotenv from "./mod.ts"

const ENV = `BASIC=basic

AFTER_EMPTY=empty
#COMMENT=not-parsed
EMPTY_VALUE=
QUOTED_SINGLE='single quoted'
QUOTED_DOUBLE="double quoted"
EMPTY_SINGLE=''
EMPTY_DOUBLE=""
MULTILINE1="hello\\nworld"
MULTILINE2="hello\\r\\nworld"
JSON='{"foo": "bar"}'
WHITESPACE='    whitespace   '
MULTILINE_SINGLE_QUOTE1='hello\\nworld'
EQUALS='equ==als'
THE_ANSWER=42
VAR_WITH_SPACE = 'var with space'
VAR_WITH_ENDING_WHITESPACE\t=value
  INDENTED_VAR='indented var'
\tTAB_INDENTED_VALUE=\tindented value
PRIVATE_KEY='
-----BEGIN KEY-----
abc
-----END KEY-----
'
export EXPORT_IS_IGNORED='export is ignored'
FOO=bar # a comment
GREETING="hello world" # a comment
`

describe("parse", () => {
  it.effect("parses values, quotes, comments and multi-line strings", () =>
    Effect.gen(function*() {
      const env = yield* Dotenv.parse(ENV)
      assertEquals(env.BASIC, "basic")
      assertEquals(env.AFTER_EMPTY, "empty")
      assertEquals(env["#COMMENT"], undefined)
      assertEquals(env.EMPTY_VALUE, "")
      assertEquals(env.QUOTED_SINGLE, "single quoted")
      assertEquals(env.QUOTED_DOUBLE, "double quoted")
      assertEquals(env.EMPTY_SINGLE, "")
      assertEquals(env.EMPTY_DOUBLE, "")
      assertEquals(env.MULTILINE1, "hello\nworld")
      assertEquals(env.MULTILINE2, "hello\r\nworld")
      assertEquals(JSON.parse(env.JSON!).foo, "bar")
      assertEquals(env.WHITESPACE, "    whitespace   ")
      assertEquals(env.MULTILINE_SINGLE_QUOTE1, "hello\\nworld")
      assertEquals(env.EQUALS, "equ==als")
      assertEquals(env.THE_ANSWER, "42")
      assertEquals(env.VAR_WITH_SPACE, "var with space")
      assertEquals(env.VAR_WITH_ENDING_WHITESPACE, "value")
      assertEquals(env.INDENTED_VAR, "indented var")
      assertEquals(env.TAB_INDENTED_VALUE, "indented value")
      assertEquals(env.PRIVATE_KEY, "-----BEGIN KEY-----\nabc\n-----END KEY-----")
      assertEquals(env.EXPORT_IS_IGNORED, "export is ignored")
      assertEquals(env.FOO, "bar")
      assertEquals(env.GREETING, "hello world")
    }))

  it.effect("expands variables in unquoted values", () =>
    Effect.gen(function*() {
      const env = yield* Dotenv.parse(`THE_ANSWER=42
A='single'
B="double"
EXPAND_VAR=$THE_ANSWER
TWO=$A!==$B
RECURSIVE=$TWO
DEFAULT_TRUE=$NO_SUCH_VAR:-default
DEFAULT_FALSE=$THE_ANSWER:-default
DEFAULT_VAR=\${NO_SUCH_VAR:-\${THE_ANSWER:-default}}
DEFAULT_PATH=\${UNDEFINED:-/default/path}
BRACKETS=\${A}!==$B
ESCAPED=\\$THE_ANSWER
QUOTED='$THE_ANSWER'
`)
      assertEquals(env.EXPAND_VAR, "42")
      assertEquals(env.TWO, "single!==double")
      assertEquals(env.RECURSIVE, "single!==double")
      assertEquals(env.DEFAULT_TRUE, "default")
      assertEquals(env.DEFAULT_FALSE, "42")
      assertEquals(env.DEFAULT_VAR, "42")
      assertEquals(env.DEFAULT_PATH, "/default/path")
      assertEquals(env.BRACKETS, "single!==double")
      assertEquals(env.ESCAPED, "\\$THE_ANSWER")
      assertEquals(env.QUOTED, "$THE_ANSWER")
    }))

  it.effect("is not affected by an extended Object.prototype", () =>
    Effect.gen(function*() {
      const env = yield* Dotenv.parse("bar=1")
      assertEquals(Object.getPrototypeOf(env), null)
      assertEquals(env.bar, "1")
    }))

  it.effect("fails on an invalid key by default", () =>
    Effect.gen(function*() {
      const error = yield* assertFailsWithTag(Dotenv.parse("A=1\n1INVALID=x\n"), "DotenvError")
      assertEquals(error.kind, "InvalidKey")
      assertEquals(error.key, "1INVALID")
    }))

  it.effect("skips invalid keys when asked", () =>
    Effect.gen(function*() {
      const env = yield* Dotenv.parse("A=1\n1INVALID='x\ny'\nB=2\n", { invalidKeys: "ignore" })
      assertEquals({ ...env }, { A: "1", B: "2" })
    }))
})

describe("stringify", () => {
  it.effect.each([
    [{ BASIC: "basic" }, "BASIC=basic"],
    [{ QUOTED_SINGLE: "single quoted" }, "QUOTED_SINGLE='single quoted'"],
    [{ MULTILINE: "hello\nworld" }, 'MULTILINE="hello\\nworld"'],
    [{ WHITESPACE: "    whitespace   " }, "WHITESPACE='    whitespace   '"],
    [{ EQUALS: "equ==als" }, "EQUALS='equ==als'"],
    [{ THE_ANSWER: "42" }, "THE_ANSWER=42"],
    [{ PARSE: "par'se" }, `PARSE="par'se"`],
    [{ A: "1", B: "2" }, "A=1\nB=2"],
  ] as const)("stringifies %#", ([record, expected]) =>
    Effect.gen(function*() {
      assertEquals(yield* Dotenv.stringify(record), expected)
    }))

  it.effect("round-trips tricky values through parse", () =>
    Effect.gen(function*() {
      const tricky = ["'", '"', "\\", "\\n", "\\r", "\\t", "\n", "\r", "\t", "$", "{", "}", " ", "="]
      for (const a of tricky) {
        for (const b of tricky) {
          const value = `start_${a}${b}_end`
          const env = yield* Dotenv.parse(yield* Dotenv.stringify({ TEST_VAR: value }))
          assertEquals(env.TEST_VAR, value, `round-trip mismatch for ${JSON.stringify(value)}`)
        }
      }
      for (const payload of [{ quoted: `He said "hi"` }, { mixed: `She said "don't"` }, { path: "C:\\Users\\t" }]) {
        const encoded = JSON.stringify(payload)
        assertEquals((yield* Dotenv.parse(yield* Dotenv.stringify({ DATA: encoded }))).DATA, encoded)
      }
    }))

  it.effect("fails on invalid keys and non-string values", () =>
    Effect.gen(function*() {
      const comment = yield* assertFailsWithTag(Dotenv.stringify({ "#COMMENT": "x" }), "DotenvError")
      assertEquals(comment.kind, "InvalidKey")
      const value = yield* assertFailsWithTag(
        Dotenv.stringify({ NULL: null } as unknown as Record<string, string>),
        "DotenvError",
      )
      assertEquals(value.kind, "InvalidValue")
      assertStringIncludes(value.message, "NULL")
    }))
})

describe("ConfigProvider", () => {
  const text = "PORT=8080\nHOST=localhost\nURL=http://$HOST:$PORT\nDB_USER=admin\nEMPTY=\n"

  it.effect("configProvider serves Config values", () =>
    Effect.gen(function*() {
      const provider = yield* Dotenv.configProvider(text)
      assertEquals(yield* Config.Port("PORT").parse(provider), 8080)
      assertEquals(yield* Config.String("URL").parse(provider), "http://localhost:8080")
      assertEquals(yield* Config.String("USER").parse(provider.pipe(ConfigProvider.nested("DB"))), "admin")
      assertEquals(yield* Config.option(Config.String("EMPTY")).parse(provider), yield* Config.option(Config.String("NOPE")).parse(provider))
    }))

  it.effect("preserves empty strings when asked", () =>
    Effect.gen(function*() {
      const provider = yield* Dotenv.configProvider(text, { preserveEmptyStrings: true })
      assertEquals(yield* Config.String("EMPTY").parse(provider), "")
    }))

  it.effect("layer replaces the ConfigProvider", () =>
    Effect.gen(function*() {
      const config = yield* Config.all({ port: Config.Port("PORT"), host: Config.String("HOST") })
      assertEquals(config, { port: 8080, host: "localhost" })
    }).pipe(Effect.provide(Dotenv.layer(text))))

  it.effect("layer fails with a DotenvError on an invalid key", () =>
    Effect.gen(function*() {
      const error = yield* assertFailsWithTag(
        Config.String("A").pipe(Effect.provide(Dotenv.layer("1A=x"))),
        "DotenvError",
      )
      assertEquals(error.key, "1A")
    }))

  it.effect("layerAdd falls back to .env values or takes precedence", () =>
    Effect.gen(function*() {
      const base = ConfigProvider.layer(ConfigProvider.fromUnknown({ PORT: "1", ONLY_BASE: "b" }))
      const fallback = Layer.provide(Dotenv.layerAdd(text), base)
      const primary = Layer.provide(Dotenv.layerAdd(text, { asPrimary: true }), base)
      const read = Config.all({ port: Config.String("PORT"), base: Config.String("ONLY_BASE"), host: Config.String("HOST") })
      assertEquals(yield* read.pipe(Effect.provide(fallback)), { port: "1", base: "b", host: "localhost" })
      assertEquals(yield* read.pipe(Effect.provide(primary)), { port: "8080", base: "b", host: "localhost" })
    }))
})
