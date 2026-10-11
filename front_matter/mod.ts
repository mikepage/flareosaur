// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * Extracts YAML, TOML or JSON front matter from a document, as an Effect and
 * a Schema codec.
 *
 * Front matter is a block of metadata at the top of a text file, fenced by
 * format-specific delimiters:
 *
 * - YAML: `---`, `---yaml` or `= yaml =`, closed by `---` or `= yaml =`
 * - TOML: `---toml`, `+++` or `= toml =`, closed by `---`, `+++` or `= toml =`
 * - JSON: `---json` or `= json =`, closed by `---` or `= json =`
 *
 * Effect has no front matter support. This module keeps `@std/front_matter`'s
 * delimiter grammar and parses the metadata with this library's
 * {@link https://jsr.io/@mikepage/flareosaur/doc/yaml | yaml} and
 * {@link https://jsr.io/@mikepage/flareosaur/doc/toml | toml} modules and
 * Effect's JSON Schema codec. Failures are a typed {@linkcode FrontMatterError},
 * and {@linkcode schema} decodes a document straight into typed attributes and
 * its body.
 *
 * ```ts
 * import { Effect, Schema } from "effect"
 * import * as FrontMatter from "@mikepage/flareosaur/front-matter"
 *
 * const Post = FrontMatter.schema(Schema.Struct({ title: Schema.String, tags: Schema.Array(Schema.String) }))
 *
 * const program = Effect.gen(function*() {
 *   const post = yield* Schema.decodeEffect(Post)("---\ntitle: Hello\ntags: [a, b]\n---\n# Hello\n")
 *   return post // { attrs: { title: "Hello", tags: ["a", "b"] }, body: "# Hello\n" }
 * })
 * ```
 *
 * @module
 */

import { type Cause, Effect, Option, Schema, SchemaGetter, SchemaIssue, SchemaTransformation } from "effect"
import * as Toml from "../toml/mod.ts"
import * as Yaml from "../yaml/mod.ts"
import { EXTRACT_REGEXP_MAP, type Format, RECOGNIZE_REGEXP_MAP } from "./_std/_formats.ts"
import { extractFrontMatter } from "./_std/_shared.ts"

export type { Format }

/** The formats this module understands, in the order they are tried. */
export const formats: ReadonlyArray<Format> = ["yaml", "toml", "json"]

const FrontMatterErrorBase: Schema.Class<
  FrontMatterError,
  Schema.TaggedStruct<"FrontMatterError", {
    readonly kind: Schema.Literals<readonly ["Unsupported", "Malformed", "Parse", "Stringify"]>
    readonly format: Schema.optional<Schema.Literals<readonly ["yaml", "toml", "json"]>>
    readonly message: Schema.String
    readonly cause: Schema.Defect
  }>,
  Cause.YieldableError
> = Schema.TaggedError<FrontMatterError>()("FrontMatterError", {
  kind: Schema.Literals(["Unsupported", "Malformed", "Parse", "Stringify"]),
  format: Schema.optional(Schema.Literals(["yaml", "toml", "json"])),
  message: Schema.String,
  cause: Schema.Defect(),
})

/** A document has no front matter in a supported format, or its front matter could not be parsed. */
export class FrontMatterError extends FrontMatterErrorBase {}

/** The result of {@linkcode extract}. */
export interface Extract<A = unknown> {
  /** The format of the front matter. */
  readonly format: Format
  /** The raw front matter text, without delimiters. */
  readonly frontMatter: string
  /** The document after the front matter. */
  readonly body: string
  /** The parsed front matter; `{}` when it is empty. */
  readonly attrs: A
}

/**
 * Tests whether a document starts with complete front matter in one of
 * `formats` (all by default).
 */
export const test = (text: string, accepted: ReadonlyArray<Format> = formats): boolean =>
  accepted.some((format) => EXTRACT_REGEXP_MAP.get(format)!.exec(text)?.index === 0)

/**
 * The format announced by a document's opening delimiter, if it is one of
 * `formats` (all by default). The front matter may still be unterminated.
 */
export const recognize = (text: string, accepted: ReadonlyArray<Format> = formats): Option.Option<Format> =>
  Option.fromNullishOr(accepted.find((format) => RECOGNIZE_REGEXP_MAP.get(format)!.test(text)))

/** Options for {@linkcode extract} and {@linkcode schema}. */
export interface ExtractOptions {
  /** The formats to accept, all by default. */
  readonly formats?: ReadonlyArray<Format> | undefined
  /** Options for the YAML parser. */
  readonly yaml?: Yaml.ParseOptions | undefined
}

const messageOf = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause)

const parseAttrs = (
  format: Format,
  frontMatter: string,
  options?: ExtractOptions,
): Effect.Effect<unknown, FrontMatterError> => {
  if (frontMatter === "") return Effect.succeed({})
  const parsed: Effect.Effect<unknown, unknown> = format === "yaml"
    ? Yaml.parse(frontMatter, options?.yaml)
    : format === "toml"
    ? Toml.parse(frontMatter)
    : Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(frontMatter)
  return Effect.mapError(parsed, (cause) =>
    new FrontMatterError({
      kind: "Parse",
      format,
      message: `Cannot parse ${format} front matter: ${messageOf(cause)}`,
      cause,
    }))
}

/**
 * Splits a document into its front matter and body, and parses the front
 * matter. The format is recognized from the opening delimiter. Fails when
 * there is no front matter in one of the accepted formats, when it is not
 * closed, or when it does not parse.
 */
export const extract: (
  text: string,
  options?: ExtractOptions,
) => Effect.Effect<Extract<unknown>, FrontMatterError> = Effect.fnUntraced(function*(
  text: string,
  options?: ExtractOptions,
): Effect.fn.Return<Extract, FrontMatterError> {
  const format = recognize(text, options?.formats)
  if (Option.isNone(format)) {
    return yield* new FrontMatterError({
      kind: "Unsupported",
      message: "Unsupported front matter format",
      cause: undefined,
    })
  }
  const split = yield* Effect.try({
    try: () => extractFrontMatter(text, EXTRACT_REGEXP_MAP.get(format.value)!),
    catch: (cause) =>
      new FrontMatterError({ kind: "Malformed", format: format.value, message: messageOf(cause), cause }),
  })
  const attrs = yield* parseAttrs(format.value, split.frontMatter, options)
  return { format: format.value, frontMatter: split.frontMatter, body: split.body, attrs }
})

/** Options for {@linkcode stringify} and {@linkcode schema}. */
export interface StringifyOptions {
  /** The format to write the front matter in. @default {"yaml"} */
  readonly format?: Format | undefined
}

/**
 * Writes a document with front matter: `attrs` in the given format (YAML by
 * default) between delimiters that {@linkcode extract} recognizes, then the
 * body.
 */
export const stringify: (
  attrs: unknown,
  body: string,
  options?: StringifyOptions,
) => Effect.Effect<string, FrontMatterError> = Effect.fnUntraced(function*(
  attrs: unknown,
  body: string,
  options?: StringifyOptions,
): Effect.fn.Return<string, FrontMatterError> {
  const format = options?.format ?? "yaml"
  const written: Effect.Effect<string, unknown> = format === "yaml"
    ? Yaml.stringify(attrs)
    : format === "toml"
    ? Toml.stringify(attrs as Record<string, unknown>)
    : Effect.map(Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown, { space: 2 }))(attrs), (s) => `${s}\n`)
  const frontMatter = yield* Effect.mapError(written, (cause) =>
    new FrontMatterError({
      kind: "Stringify",
      format,
      message: `Cannot write ${format} front matter: ${messageOf(cause)}`,
      cause,
    }))
  const open = format === "yaml" ? "---" : `---${format}`
  return `${open}\n${frontMatter}---\n${body}`
})

const issue = (error: unknown, input: unknown) => new SchemaIssue.InvalidValue({ message: messageOf(error) }, input)

/** Options for {@linkcode schema}. */
export interface SchemaOptions extends ExtractOptions, StringifyOptions {}

/**
 * A transformation between a document and its parsed front matter and body.
 * Encoding writes the front matter in `options.format` (YAML by default).
 */
export const transformation = <A = { readonly attrs: unknown; readonly body: string }>(
  options?: SchemaOptions,
): SchemaTransformation.Transformation<A, string> =>
  new SchemaTransformation.Transformation(
    SchemaGetter.transformEffect((text: string) =>
      extract(text, options).pipe(
        Effect.map(({ attrs, body }) => ({ attrs, body }) as A),
        Effect.mapError((e) => issue(e, text)),
      )
    ),
    SchemaGetter.transformEffect((value: A) =>
      stringify(
        (value as { readonly attrs: unknown }).attrs,
        (value as { readonly body: string }).body,
        options,
      ).pipe(Effect.mapError((e) => issue(e, value)))
    ),
  )

/**
 * A Schema that decodes a document with front matter into
 * `{ attrs: S, body }`, and encodes it back with the front matter in
 * `options.format` (YAML by default).
 *
 * ```ts
 * import { Schema } from "effect"
 * import * as FrontMatter from "@mikepage/flareosaur/front-matter"
 *
 * const decode = Schema.decodeUnknownSync(FrontMatter.schema(Schema.Struct({ title: Schema.String })))
 * decode("+++\ntitle = 'Hi'\n+++\nbody") // { attrs: { title: "Hi" }, body: "body" }
 * ```
 */
export const schema = <S extends Schema.Top>(
  attrs: S,
  options?: SchemaOptions,
): Schema.decodeTo<Schema.Struct<{ readonly attrs: S; readonly body: Schema.String }>, Schema.String> => {
  const target = Schema.Struct({ attrs, body: Schema.String })
  return Schema.String.pipe(Schema.decodeTo(target, transformation<typeof target["Encoded"]>(options)))
}
