// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * Entity tags: compute them from content, compare them with `If-Match` and
 * `If-None-Match`, and answer conditional requests with `304 Not Modified`.
 *
 * `effect/http/Etag` models a tag (`Etag.Weak` / `Etag.Strong`) and derives
 * tags from file metadata for the static file server. This module adds
 * std's `eTag` (a SHA-256 digest of the content via Web Crypto),
 * `ifMatch` and `ifNoneMatch`, all producing or accepting Effect's `Etag`
 * values, plus {@linkcode respond}, which checks the current request's
 * `If-None-Match` and returns either the response with an `ETag` header or a
 * `304`.
 *
 * ```ts
 * import { Effect } from "effect"
 * import { HttpServerResponse } from "effect/http"
 * import * as ETag from "@mikepage/flareosaur/http/etag"
 *
 * const handler = Effect.gen(function*() {
 *   const body = "hello"
 *   const tag = yield* ETag.fromEntity(body)
 *   return yield* ETag.respond(HttpServerResponse.text(body), tag)
 * })
 * ```
 *
 * @module
 */

import { Effect, Function, Option, Schema } from "effect"
import { Etag, Headers, HttpServerRequest, HttpServerResponse } from "effect/http"
import { eTag as stdETag, type ETagOptions, type FileInfo, ifMatch as stdIfMatch, ifNoneMatch as stdIfNoneMatch } from "./_std/etag.ts"
import { header, type HeadersInput, message } from "./_internal.ts"

export type { FileInfo }

/** An entity tag could not be computed (for example, an unknown digest algorithm). */
export class EtagError extends Schema.TaggedError<EtagError>()("EtagError", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

/** Options for computing a tag. */
export interface Options {
  /** The digest algorithm (default `SHA-256`). */
  readonly algorithm?: AlgorithmIdentifier | undefined
  /** Make a weak tag. Defaults to `false` for content, `true` for file info. */
  readonly weak?: boolean | undefined
}

/**
 * Parses an `ETag` header value (`"abc"` or `W/"abc"`). Returns `None` for
 * values that are not a quoted tag.
 */
export const parse = (value: string): Option.Option<Etag.Etag> => {
  const match = /^\s*(W\/)?"([^"]*)"\s*$/.exec(value)
  if (!match) return Option.none()
  return Option.some(match[1] ? { _tag: "Weak", value: match[2]! } : { _tag: "Strong", value: match[2]! })
}

/** Formats a tag as a header value (`Etag.toString` from Effect). */
export const format: (self: Etag.Etag) => string = Etag.toString

const stdOptions = (options?: Options): ETagOptions => ({
  ...(options?.algorithm !== undefined ? { algorithm: options.algorithm } : {}),
  ...(options?.weak !== undefined ? { weak: options.weak } : {}),
})

const run = (f: () => Promise<string | undefined>) =>
  Effect.tryPromise({ try: f, catch: (cause) => new EtagError({ message: message(cause), cause }) }).pipe(
    Effect.map((tag) => Option.flatMap(Option.fromUndefinedOr(tag), parse)),
  )

/**
 * Computes a tag from content: its length and a SHA-256 digest (or the
 * given algorithm), strong unless `weak` is set.
 */
export const fromEntity = (entity: string | Uint8Array, options?: Options): Effect.Effect<Etag.Etag, EtagError> =>
  run(() => stdETag(entity as string, stdOptions(options))).pipe(
    Effect.flatMap(Option.match({
      onNone: () => Effect.fail(new EtagError({ message: "Cannot compute entity tag", cause: entity })),
      onSome: Effect.succeed,
    })),
  )

/**
 * Computes a weak tag from file metadata (size and modification time).
 * `None` when the modification time is unknown.
 */
export const fromFileInfo = (info: FileInfo, options?: Options): Effect.Effect<Option.Option<Etag.Etag>, EtagError> =>
  run(() => stdETag(info, stdOptions(options)))

const toHeaderValue = (etag: Etag.Etag | string): string => typeof etag === "string" ? etag : Etag.toString(etag)

/**
 * Whether an `If-Match` header value matches the tag (strong comparison: a
 * weak tag never matches). A missing header never matches.
 */
export const ifMatch: {
  (etag: Etag.Etag | string): (value: string | null | undefined) => boolean
  (value: string | null | undefined, etag: Etag.Etag | string): boolean
} = Function.dual(
  2,
  (value: string | null | undefined, etag: Etag.Etag | string): boolean => stdIfMatch(value ?? null, toHeaderValue(etag)),
)

/**
 * Whether an `If-None-Match` header value does *not* match the tag (weak
 * comparison), so the full response should be sent. A missing header means
 * the response should be sent.
 */
export const ifNoneMatch: {
  (etag: Etag.Etag | string): (value: string | null | undefined) => boolean
  (value: string | null | undefined, etag: Etag.Etag | string): boolean
} = Function.dual(
  2,
  (value: string | null | undefined, etag: Etag.Etag | string): boolean =>
    stdIfNoneMatch(value ?? null, toHeaderValue(etag)),
)

/** Whether a request's `If-None-Match` says it already has this tag (answer `304`). */
export const isNotModified = (request: HeadersInput, etag: Etag.Etag): boolean =>
  !ifNoneMatch(Option.getOrNull(header(request, "if-none-match")), etag)

/** Whether a request's `If-Match` precondition fails for this tag (answer `412`). */
export const isPreconditionFailed = (request: HeadersInput, etag: Etag.Etag): boolean =>
  Option.match(header(request, "if-match"), { onNone: () => false, onSome: (value) => !ifMatch(value, etag) })

/**
 * Answers the current request with `response` and an `ETag` header, or with
 * an empty `304 Not Modified` when its `If-None-Match` already has the tag.
 */
export const respond: {
  (etag: Etag.Etag): (
    response: HttpServerResponse.HttpServerResponse,
  ) => Effect.Effect<HttpServerResponse.HttpServerResponse, never, HttpServerRequest.HttpServerRequest>
  (
    response: HttpServerResponse.HttpServerResponse,
    etag: Etag.Etag,
  ): Effect.Effect<HttpServerResponse.HttpServerResponse, never, HttpServerRequest.HttpServerRequest>
} = Function.dual(
  2,
  (response: HttpServerResponse.HttpServerResponse, etag: Etag.Etag) =>
    HttpServerRequest.HttpServerRequest.useSync((request) => {
      const value = Etag.toString(etag)
      if (!isNotModified(request, etag)) return HttpServerResponse.setHeader(response, "etag", value)
      const headers = Headers.removeMany(response.headers, ["content-type", "content-length"])
      return HttpServerResponse.empty({ status: 304, headers: Headers.set(headers, "etag", value) })
    }),
)
