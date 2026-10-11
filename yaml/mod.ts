// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * YAML 1.2 parsing and stringifying, as Effects and Schema codecs.
 *
 * `effect/encoding/Yaml` ships a small configuration parser. This module is
 * the full YAML 1.2 implementation from `@std/yaml` (multi-document streams,
 * tags, the core/default/extended schemas, stringify with styles), wrapped
 * for Effect: failures are a typed {@linkcode YamlError}, and
 * {@linkcode schema} decodes YAML text straight into a typed value.
 *
 * ```ts
 * import { Effect, Schema } from "effect"
 * import * as Yaml from "@mikepage/flareosaur/yaml"
 *
 * const Config = Schema.Struct({ name: Schema.String, port: Schema.Int })
 *
 * const program = Effect.gen(function*() {
 *   const config = yield* Schema.decodeEffect(Yaml.schema(Config))("name: api\nport: 8080\n")
 *   const text = yield* Yaml.stringify({ ...config, port: 9090 })
 *   return text // "name: api\nport: 9090\n"
 * })
 * ```
 *
 * @module
 */

import { type Cause, Effect, Schema, SchemaGetter, SchemaIssue, SchemaTransformation } from "effect"
import { parse as stdParse, parseAll as stdParseAll, type ParseOptions } from "./_std/parse.ts"
import { stringify as stdStringify, type StringifyOptions } from "./_std/stringify.ts"

export type { ParseOptions, StringifyOptions }

const YamlErrorBase: Schema.Class<
  YamlError,
  Schema.TaggedStruct<"YamlError", {
    readonly kind: Schema.Literals<readonly ["Parse", "Stringify"]>
    readonly message: Schema.String
    readonly cause: Schema.Defect
  }>,
  Cause.YieldableError
> = Schema.TaggedError<YamlError>()("YamlError", {
  kind: Schema.Literals(["Parse", "Stringify"]),
  message: Schema.String,
  cause: Schema.Defect(),
})

/** A YAML document could not be parsed, or a value could not be stringified. */
export class YamlError extends YamlErrorBase {}

const parseError = (cause: unknown) =>
  new YamlError({ kind: "Parse", message: cause instanceof Error ? cause.message : String(cause), cause })

const stringifyError = (cause: unknown) =>
  new YamlError({ kind: "Stringify", message: cause instanceof Error ? cause.message : String(cause), cause })

/**
 * Parses one YAML document. A stream with more than one document fails; use
 * {@linkcode parseAll} for those.
 */
export const parse = (text: string, options?: ParseOptions): Effect.Effect<unknown, YamlError> =>
  Effect.try({ try: () => stdParse(text, options), catch: parseError })

/** Parses every document of a YAML stream (documents separated by `---`). */
export const parseAll = (text: string, options?: ParseOptions): Effect.Effect<Array<unknown>, YamlError> =>
  Effect.try({ try: () => stdParseAll(text, options) as Array<unknown>, catch: parseError })

/** Stringifies a value as a YAML document. */
export const stringify = (value: unknown, options?: StringifyOptions): Effect.Effect<string, YamlError> =>
  Effect.try({ try: () => stdStringify(value, options), catch: stringifyError })

/** Options for {@linkcode schema}. */
export interface SchemaOptions {
  readonly parse?: ParseOptions | undefined
  readonly stringify?: StringifyOptions | undefined
}

const issue = (error: unknown, input: unknown) =>
  new SchemaIssue.InvalidValue({ message: error instanceof Error ? error.message : String(error) }, input)

/** A transformation between YAML text and the value it holds. */
export const transformation = (options?: SchemaOptions): SchemaTransformation.Transformation<unknown, string> =>
  new SchemaTransformation.Transformation(
    SchemaGetter.transformEffect((text: string) =>
      Effect.try({ try: () => stdParse(text, options?.parse), catch: (e) => issue(e, text) })
    ),
    SchemaGetter.transformEffect((value: unknown) =>
      Effect.try({ try: () => stdStringify(value, options?.stringify), catch: (e) => issue(e, value) })
    ),
  )

/**
 * A Schema that decodes YAML text into `S` and encodes `S` back to YAML.
 *
 * ```ts
 * import { Schema } from "effect"
 * import * as Yaml from "@mikepage/flareosaur/yaml"
 *
 * const decode = Schema.decodeUnknownSync(Yaml.schema(Schema.Struct({ a: Schema.Number })))
 * decode("a: 1") // { a: 1 }
 * ```
 */
export const schema = <S extends Schema.Top>(target: S, options?: SchemaOptions): Schema.decodeTo<S, Schema.String> =>
  Schema.String.pipe(Schema.decodeTo(target, transformation(options)))

/** YAML text decoded to an unknown value. */
export const UnknownFromYaml: Schema.decodeTo<Schema.Unknown, Schema.String> = schema(Schema.Unknown)
