// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * JSON with Comments (JSONC) parsing, as an Effect and a Schema codec.
 *
 * JSONC is JSON plus line and block comments and trailing commas, as used
 * by `tsconfig.json`, `deno.json` and `wrangler.jsonc`. Effect has no JSONC
 * parser; this module wraps the one from `@std/jsonc`: failures are a typed
 * {@linkcode JsoncError}, and {@linkcode schema} decodes JSONC text straight
 * into a typed value (encoding writes plain JSON).
 *
 * ```ts
 * import { Effect, Schema } from "effect"
 * import * as Jsonc from "@mikepage/flareosaur/jsonc"
 *
 * const Wrangler = Schema.Struct({ name: Schema.String, main: Schema.String })
 *
 * const program = Effect.gen(function*() {
 *   const config = yield* Schema.decodeEffect(Jsonc.schema(Wrangler))(`{
 *     // the worker's name
 *     "name": "api",
 *     "main": "src/index.ts",
 *   }`)
 *   return config.name // "api"
 * })
 * ```
 *
 * @module
 */

import { Effect, Schema, SchemaGetter, SchemaIssue, SchemaTransformation } from "effect"
import { parse as stdParse } from "./_std/parse.ts"

/** A JSONC document could not be parsed. */
export class JsoncError extends Schema.TaggedError<JsoncError>()("JsoncError", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

const messageOf = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause)

const parseUnsafe = (text: string): Schema.Json => {
  if (typeof text !== "string") throw new TypeError(`Cannot parse JSONC: expected a string, got ${typeof text}`)
  return stdParse(text) as Schema.Json
}

/**
 * Parses a JSONC document. Comments and trailing commas are allowed;
 * duplicate keys keep the last value, like `JSON.parse`, and `__proto__`
 * keys are set as own properties.
 */
export const parse = (text: string): Effect.Effect<Schema.Json, JsoncError> =>
  Effect.try({ try: () => parseUnsafe(text), catch: (cause) => new JsoncError({ message: messageOf(cause), cause }) })

/** Options for {@linkcode schema}. */
export interface SchemaOptions {
  /** Indentation of the JSON that encoding writes, as for `JSON.stringify`. */
  readonly space?: string | number | undefined
}

const issue = (error: unknown, input: unknown) => new SchemaIssue.InvalidValue({ message: messageOf(error) }, input)

/** A transformation between JSONC text (encoded as plain JSON) and the value it holds. */
export const transformation = (options?: SchemaOptions): SchemaTransformation.Transformation<unknown, string> =>
  new SchemaTransformation.Transformation(
    SchemaGetter.transformEffect((text: string) =>
      Effect.try({ try: (): unknown => parseUnsafe(text), catch: (e) => issue(e, text) })
    ),
    SchemaGetter.transformEffect((value: unknown) =>
      Effect.try({
        try: () => {
          const text = JSON.stringify(value, null, options?.space)
          if (text === undefined) throw new TypeError("The value cannot be represented as JSON")
          return text
        },
        catch: (e) => issue(e, value),
      })
    ),
  )

/**
 * A Schema that decodes JSONC text into `S` and encodes `S` as JSON.
 *
 * ```ts
 * import { Schema } from "effect"
 * import * as Jsonc from "@mikepage/flareosaur/jsonc"
 *
 * const decode = Schema.decodeUnknownSync(Jsonc.schema(Schema.Struct({ a: Schema.Number })))
 * decode('{ "a": 1, }') // { a: 1 }
 * ```
 */
export const schema = <S extends Schema.Top>(target: S, options?: SchemaOptions) =>
  Schema.String.pipe(Schema.decodeTo(target, transformation(options)))

/** JSONC text decoded to an unknown value. */
export const UnknownFromJsonc = schema(Schema.Unknown)
