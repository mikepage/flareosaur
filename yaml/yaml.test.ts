// Copyright 2026 the flareosaur authors. MIT license.
import { Effect, Schema } from "effect"
import { describe, it } from "../testing/mod.ts"
import { assertEquals, assertFailsWithTag } from "../assert/mod.ts"
import * as Yaml from "./mod.ts"

describe("parse", () => {
  it.effect("parses a document", () =>
    Effect.gen(function*() {
      assertEquals(yield* Yaml.parse("a: 1\nb: [x, y]\n"), { a: 1, b: ["x", "y"] })
    }))

  it.effect("fails with a YamlError on invalid input", () =>
    Effect.gen(function*() {
      const error = yield* assertFailsWithTag(Yaml.parse("a: [1, 2"), "YamlError")
      assertEquals(error.kind, "Parse")
    }))

  it.effect("parses every document of a stream", () =>
    Effect.gen(function*() {
      assertEquals(yield* Yaml.parseAll("a: 1\n---\nb: 2\n"), [{ a: 1 }, { b: 2 }])
    }))
})

describe("stringify", () => {
  it.effect("stringifies a value", () =>
    Effect.gen(function*() {
      assertEquals(yield* Yaml.stringify({ a: 1, b: ["x"] }), "a: 1\nb:\n  - x\n")
    }))

  it.effect("fails on values YAML cannot hold", () =>
    Effect.gen(function*() {
      const error = yield* assertFailsWithTag(Yaml.stringify({ f: () => 1 }), "YamlError")
      assertEquals(error.kind, "Stringify")
    }))
})

describe("schema", () => {
  const Config = Schema.Struct({ name: Schema.String, port: Schema.Int })

  it.effect("decodes YAML into a typed value and encodes it back", () =>
    Effect.gen(function*() {
      const config = yield* Schema.decodeEffect(Yaml.schema(Config))("name: api\nport: 8080\n")
      assertEquals(config, { name: "api", port: 8080 })
      assertEquals(yield* Schema.encodeEffect(Yaml.schema(Config))(config), "name: api\nport: 8080\n")
    }))

  it.effect("reports YAML and schema errors as schema issues", () =>
    Effect.gen(function*() {
      yield* assertFailsWithTag(Schema.decodeEffect(Yaml.schema(Config))("name: [x"), "SchemaError")
      yield* assertFailsWithTag(Schema.decodeEffect(Yaml.schema(Config))("name: api\nport: x\n"), "SchemaError")
    }))
})
