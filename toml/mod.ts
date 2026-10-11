// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * TOML v1.0 parsing and stringifying, as Effects and Schema codecs.
 *
 * `effect/encoding/Toml` ships a small configuration parser. This module is
 * the parser from `@std/toml`, which passes the official TOML test suite,
 * plus its stringifier, wrapped for Effect: failures are a typed
 * {@linkcode TomlError}, and {@linkcode schema} decodes TOML text straight
 * into a typed value.
 *
 * ```ts
 * import { Effect, Schema } from "effect"
 * import * as Toml from "@mikepage/flareosaur/toml"
 *
 * const Config = Schema.Struct({ name: Schema.String, port: Schema.Int })
 *
 * const program = Effect.gen(function*() {
 *   const config = yield* Schema.decodeEffect(Toml.schema(Config))('name = "api"\nport = 8080\n')
 *   const text = yield* Toml.stringify({ ...config, port: 9090 })
 *   return text // 'name = "api"\nport = 9090\n'
 * })
 * ```
 *
 * @module
 */

import { Effect, Predicate, Schema, SchemaGetter, SchemaIssue, SchemaTransformation } from "effect"
import { parse as stdParse } from "./_std/parse.ts"
import { stringify as stdStringify, type StringifyOptions } from "./_std/stringify.ts"

export type { StringifyOptions }

/** A TOML document could not be parsed, or a value could not be stringified. */
export class TomlError extends Schema.TaggedError<TomlError>()("TomlError", {
  kind: Schema.Literals(["Parse", "Stringify"]),
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

const messageOf = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause)

const parseError = (cause: unknown) => new TomlError({ kind: "Parse", message: messageOf(cause), cause })

const stringifyError = (cause: unknown) => new TomlError({ kind: "Stringify", message: messageOf(cause), cause })

const stringifyUnsafe = (value: unknown, options?: StringifyOptions): string => {
  if (!Predicate.isObject(value) || Array.isArray(value)) {
    throw new TypeError("A TOML document must be a table (a plain object)")
  }
  return stdStringify(value as Record<string, unknown>, options)
}

/**
 * Parses a TOML document into a record. Date-times and dates become `Date`s;
 * local times stay strings. Errors carry the line and column.
 */
export const parse = (text: string): Effect.Effect<Record<string, unknown>, TomlError> =>
  Effect.try({ try: () => stdParse(text), catch: parseError })

/**
 * Stringifies a record as a TOML document. Fails when the value is not a
 * table or holds values TOML cannot represent (such as `null`).
 */
export const stringify = (
  value: Record<string, unknown>,
  options?: StringifyOptions,
): Effect.Effect<string, TomlError> => Effect.try({ try: () => stringifyUnsafe(value, options), catch: stringifyError })

/** Options for {@linkcode schema}. */
export interface SchemaOptions {
  readonly stringify?: StringifyOptions | undefined
}

const issue = (error: unknown, input: unknown) => new SchemaIssue.InvalidValue({ message: messageOf(error) }, input)

/** A transformation between TOML text and the record it holds. */
export const transformation = (options?: SchemaOptions): SchemaTransformation.Transformation<unknown, string> =>
  new SchemaTransformation.Transformation(
    SchemaGetter.transformEffect((text: string) =>
      Effect.try({ try: (): unknown => stdParse(text), catch: (e) => issue(e, text) })
    ),
    SchemaGetter.transformEffect((value: unknown) =>
      Effect.try({ try: () => stringifyUnsafe(value, options?.stringify), catch: (e) => issue(e, value) })
    ),
  )

/**
 * A Schema that decodes TOML text into `S` and encodes `S` back to TOML.
 *
 * ```ts
 * import { Schema } from "effect"
 * import * as Toml from "@mikepage/flareosaur/toml"
 *
 * const decode = Schema.decodeUnknownSync(Toml.schema(Schema.Struct({ a: Schema.Number })))
 * decode("a = 1") // { a: 1 }
 * ```
 */
export const schema = <S extends Schema.Top>(target: S, options?: SchemaOptions) =>
  Schema.String.pipe(Schema.decodeTo(target, transformation(options)))

/** TOML text decoded to an unknown value. */
export const UnknownFromToml = schema(Schema.Unknown)
