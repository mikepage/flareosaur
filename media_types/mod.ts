// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * Media types (MIME types): look them up by extension, find their
 * extensions and charset, and parse or format `Content-Type` style values.
 *
 * `effect/http/Mime` maps paths to types and back (`Mime.getType`,
 * `Mime.getExtension`, `Mime.getAllExtensions`). This module adds what
 * `@std/media_types` offers on top, backed by std's copy of the `mime-db`
 * database:
 *
 * | std                | here                                             |
 * | ------------------ | ------------------------------------------------ |
 * | `contentType`      | {@linkcode contentType} (`Option`)               |
 * | `typeByExtension`  | {@linkcode typeByExtension} (`Option`)           |
 * | `extension`        | {@linkcode extension} (`Option`)                 |
 * | `allExtensions`    | {@linkcode allExtensions} (`Option`)             |
 * | `getCharset`       | {@linkcode getCharset} (`Option`)                |
 * | `parseMediaType`   | {@linkcode parseMediaType} (`Result`, {@linkcode MediaTypeError}) |
 * | `formatMediaType`  | {@linkcode formatMediaType} (`Result`, {@linkcode MediaTypeError}) |
 *
 * {@linkcode MediaTypeFromString} is a Schema codec between a header value
 * and a {@linkcode MediaType}.
 *
 * ```ts
 * import { Option, Result } from "effect"
 * import * as MediaTypes from "@mikepage/flareosaur/media-types"
 *
 * MediaTypes.contentType(".json") // Option.some("application/json; charset=UTF-8")
 * MediaTypes.typeByExtension("png") // Option.some("image/png")
 *
 * const parsed = MediaTypes.parseMediaType("text/html; charset=UTF-8")
 * Result.getOrThrow(parsed) // { type: "text/html", parameters: { charset: "UTF-8" } }
 * ```
 *
 * @module
 */

import { Effect, Option, Result, Schema, SchemaIssue, SchemaTransformation } from "effect"
import { db, extensions as extensionDb, type KeyOfDb, types as typeDb } from "./_std/_db.ts"
import type { DBEntry } from "./_std/_util.ts"
import { formatMediaType as stdFormat } from "./_std/format_media_type.ts"
import { parseMediaType as stdParse } from "./_std/parse_media_type.ts"
import type { KnownExtensionOrType } from "./_std/content_type.ts"

export type { KnownExtensionOrType }

/** A media type could not be parsed or formatted. */
export class MediaTypeError extends Schema.TaggedError<MediaTypeError>()("MediaTypeError", {
  kind: Schema.Literals(["Parse", "Format"]),
  input: Schema.String,
  message: Schema.String,
}) {}

/** A parsed media type: the lowercased `type/subtype` and its parameters. */
export const MediaType = Schema.Struct({
  type: Schema.String,
  parameters: Schema.Record(Schema.String, Schema.String),
})

/** A parsed media type: the lowercased `type/subtype` and its parameters. */
export interface MediaType extends Schema.Schema.Type<typeof MediaType> {}

/**
 * Parses a media type and its parameters, as found in `Content-Type` and
 * `Content-Disposition` headers. Supports RFC 2231 continuations and
 * extended (`*`) parameters.
 *
 * ```ts
 * import { Result } from "effect"
 * import { parseMediaType } from "@mikepage/flareosaur/media-types"
 *
 * Result.getOrThrow(parseMediaType(`form-data; name="foo"`))
 * // { type: "form-data", parameters: { name: "foo" } }
 * ```
 */
export const parseMediaType = (input: string): Result.Result<MediaType, MediaTypeError> => {
  try {
    const [type, parameters] = stdParse(input)
    return Result.succeed({ type, parameters: parameters ?? {} })
  } catch (cause) {
    return Result.fail(
      new MediaTypeError({ kind: "Parse", input, message: cause instanceof Error ? cause.message : String(cause) }),
    )
  }
}

/**
 * Formats a media type and parameters as a header value. Parameter names
 * are sorted and lowercased; values are quoted or RFC 2231 encoded as
 * needed. Fails when the type or a parameter name is not a valid token.
 *
 * ```ts
 * import { Result } from "effect"
 * import { formatMediaType } from "@mikepage/flareosaur/media-types"
 *
 * Result.getOrThrow(formatMediaType("text/html", { charset: "UTF-8" })) // "text/html; charset=UTF-8"
 * ```
 */
export const formatMediaType = (
  type: string,
  parameters?: Readonly<Record<string, string>> | Iterable<readonly [string, string]>,
): Result.Result<string, MediaTypeError> => {
  const params = parameters === undefined
    ? undefined
    : Symbol.iterator in parameters
    ? Object.fromEntries(parameters as Iterable<readonly [string, string]>)
    : { ...parameters as Record<string, string> }
  const out = stdFormat(type, params)
  return out === ""
    ? Result.fail(new MediaTypeError({ kind: "Format", input: type, message: `Cannot format media type "${type}"` }))
    : Result.succeed(out)
}

const toIssue = (input: unknown) => (error: MediaTypeError): SchemaIssue.Issue =>
  new SchemaIssue.InvalidValue({ message: error.message }, input)

/**
 * A Schema that decodes a header value into a {@linkcode MediaType} and
 * encodes it back with {@linkcode formatMediaType}.
 */
export const MediaTypeFromString = Schema.String.pipe(
  Schema.decodeTo(
    MediaType,
    SchemaTransformation.transformEffect({
      decode: (input: string) => Effect.fromResult(parseMediaType(input)).pipe(Effect.mapError(toIssue(input))),
      encode: (value: MediaType) =>
        Effect.fromResult(formatMediaType(value.type, value.parameters)).pipe(Effect.mapError(toIssue(value))),
    }),
  ),
)

/**
 * Returns the media type for an extension (with or without a leading dot,
 * case-insensitive).
 *
 * ```ts
 * import { typeByExtension } from "@mikepage/flareosaur/media-types"
 *
 * typeByExtension(".HTML") // Option.some("text/html")
 * typeByExtension("file.json") // Option.none()
 * ```
 */
export const typeByExtension = (extension: string): Option.Option<string> => {
  const ext = extension.startsWith(".") ? extension.slice(1) : extension
  return Option.fromUndefinedOr(typeDb.get(ext.toLowerCase()))
}

/**
 * Returns every extension registered for a media type. Parameters are
 * ignored.
 *
 * ```ts
 * import { allExtensions } from "@mikepage/flareosaur/media-types"
 *
 * allExtensions("text/javascript") // Option.some(["js", "mjs"])
 * ```
 */
export const allExtensions = (type: string): Option.Option<ReadonlyArray<string>> =>
  Result.getSuccess(parseMediaType(type)).pipe(
    Option.flatMap(({ type }) => Option.fromUndefinedOr(extensionDb.get(type))),
  )

/**
 * Returns the preferred extension for a media type.
 *
 * ```ts
 * import { extension } from "@mikepage/flareosaur/media-types"
 *
 * extension("text/html; charset=UTF-8") // Option.some("html")
 * ```
 */
export const extension = (type: string): Option.Option<string> =>
  allExtensions(type).pipe(Option.flatMap((exts) => Option.fromUndefinedOr(exts[0])))

const entry = (type: string): DBEntry | undefined => db[type as KeyOfDb] as DBEntry | undefined

/**
 * Returns the charset of a media type: its `charset` parameter, the
 * database's default, or `UTF-8` for `text/*`.
 *
 * ```ts
 * import { getCharset } from "@mikepage/flareosaur/media-types"
 *
 * getCharset("text/plain") // Option.some("UTF-8")
 * getCharset("application/foo") // Option.none()
 * ```
 */
export const getCharset = (type: string): Option.Option<string> =>
  Result.getSuccess(parseMediaType(type)).pipe(
    Option.flatMap(({ type, parameters }) => {
      if (parameters.charset) return Option.some(parameters.charset)
      const charset = entry(type)?.charset
      if (charset) return Option.some(charset)
      return type.startsWith("text/") ? Option.some("UTF-8") : Option.none()
    }),
  )

/**
 * Whether the database marks a media type as compressible. `None` when the
 * database has no opinion.
 */
export const isCompressible = (type: string): Option.Option<boolean> =>
  Result.getSuccess(parseMediaType(type)).pipe(
    Option.flatMap(({ type }) => Option.fromUndefinedOr(entry(type)?.compressible)),
  )

/**
 * Returns a full `Content-Type` header value for an extension or media type,
 * adding the default charset when there is one.
 *
 * ```ts
 * import { contentType } from "@mikepage/flareosaur/media-types"
 *
 * contentType(".json") // Option.some("application/json; charset=UTF-8")
 * contentType("text/plain; charset=ISO-8859-1") // Option.some("text/plain; charset=ISO-8859-1")
 * contentType("foo") // Option.none()
 * ```
 */
export const contentType = (extensionOrType: KnownExtensionOrType | (string & {})): Option.Option<string> => {
  const base: Option.Option<MediaType> = extensionOrType.includes("/")
    ? Result.getSuccess(parseMediaType(extensionOrType))
    : typeByExtension(extensionOrType).pipe(Option.map((type) => ({ type, parameters: {} })))
  return base.pipe(
    Option.filter(({ type }) => type !== ""),
    Option.flatMap(({ type, parameters }) => {
      const params = { ...parameters }
      if (!("charset" in params)) {
        const charset = getCharset(type)
        if (Option.isSome(charset)) params.charset = charset.value
      }
      return Result.getSuccess(formatMediaType(type, params))
    }),
  )
}
