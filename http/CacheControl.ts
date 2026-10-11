// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * The `Cache-Control` header (RFC 9111 §5.2): parse it into typed
 * directives, format directives back, and read or set it on Effect HTTP
 * messages.
 *
 * Effect has no `Cache-Control` model. This is std's
 * `unstable_cache_control` with time values as `Duration`, formatting as a
 * `Result` with a typed {@linkcode CacheControlError}, and a
 * {@linkcode CacheControlFromString} Schema codec.
 *
 * Parsing follows the RFC: unknown directives and malformed values are
 * ignored, the first occurrence of a directive wins, and delta-seconds are
 * clamped to 2^31.
 *
 * ```ts
 * import { Duration, Effect } from "effect"
 * import { HttpServerResponse } from "effect/http"
 * import * as CacheControl from "@mikepage/flareosaur/http/cache-control"
 *
 * CacheControl.parse("public, max-age=3600")
 * // { public: true, maxAge: Duration.seconds(3600) }
 *
 * const response = HttpServerResponse.text("hi").pipe(
 *   CacheControl.set({ public: true, maxAge: Duration.hours(1), immutable: true }),
 * ) // Effect<HttpServerResponse, CacheControlError>
 * ```
 *
 * @module
 */

import { type Cause, Duration, Effect, Function, Option, Result, Schema } from "effect"
import { Headers, HttpServerRequest, HttpServerResponse } from "effect/http"
import {
  type CacheControl as StdCacheControl,
  formatCacheControl,
  parseCacheControl,
} from "./_std/unstable_cache_control.ts"
import { fromResults, header, type HeadersInput, message } from "./_internal.ts"

const CacheControlErrorBase: Schema.Class<
  CacheControlError,
  Schema.TaggedStruct<"CacheControlError", {
    readonly message: Schema.String
    readonly cause: Schema.Defect
  }>,
  Cause.YieldableError
> = Schema.TaggedError<CacheControlError>()("CacheControlError", {
  message: Schema.String,
  cause: Schema.Defect(),
})

/** A `Cache-Control` value could not be formatted. */
export class CacheControlError extends CacheControlErrorBase {}

const FieldNames: Schema.Union<readonly [Schema.Literal<true>, Schema.$Array<Schema.String>]> =
  Schema.Union([Schema.Literal(true), Schema.Array(Schema.String)])

/**
 * The directives of a `Cache-Control` header, request and response
 * directives together. Absent directives are absent keys.
 */
export const CacheControl: Schema.Struct<{
  /** `max-age`: how long a response stays fresh. */
  readonly maxAge: Schema.optionalKey<Schema.Duration>
  /** `no-cache`; on responses, optionally limited to some header fields. */
  readonly noCache: Schema.optionalKey<typeof FieldNames>
  /** `no-store`. */
  readonly noStore: Schema.optionalKey<Schema.Literal<true>>
  /** `no-transform`. */
  readonly noTransform: Schema.optionalKey<Schema.Literal<true>>
  /** `max-stale` (request): accept stale responses, optionally up to a limit. */
  readonly maxStale: Schema.optionalKey<Schema.Union<readonly [Schema.Literal<true>, Schema.Duration]>>
  /** `min-fresh` (request). */
  readonly minFresh: Schema.optionalKey<Schema.Duration>
  /** `only-if-cached` (request). */
  readonly onlyIfCached: Schema.optionalKey<Schema.Literal<true>>
  /** `s-maxage` (response): `max-age` for shared caches. */
  readonly sMaxage: Schema.optionalKey<Schema.Duration>
  /** `private` (response); optionally limited to some header fields. */
  readonly private: Schema.optionalKey<typeof FieldNames>
  /** `public` (response). */
  readonly public: Schema.optionalKey<Schema.Literal<true>>
  /** `must-revalidate` (response). */
  readonly mustRevalidate: Schema.optionalKey<Schema.Literal<true>>
  /** `proxy-revalidate` (response). */
  readonly proxyRevalidate: Schema.optionalKey<Schema.Literal<true>>
  /** `must-understand` (response). */
  readonly mustUnderstand: Schema.optionalKey<Schema.Literal<true>>
  /** `immutable` (response, RFC 8246). */
  readonly immutable: Schema.optionalKey<Schema.Literal<true>>
  /** `stale-while-revalidate` (response, RFC 5861). */
  readonly staleWhileRevalidate: Schema.optionalKey<Schema.Duration>
  /** `stale-if-error` (RFC 5861). */
  readonly staleIfError: Schema.optionalKey<Schema.Duration>
}> = Schema.Struct({
  /** `max-age`: how long a response stays fresh. */
  maxAge: Schema.optionalKey(Schema.Duration),
  /** `no-cache`; on responses, optionally limited to some header fields. */
  noCache: Schema.optionalKey(FieldNames),
  /** `no-store`. */
  noStore: Schema.optionalKey(Schema.Literal(true)),
  /** `no-transform`. */
  noTransform: Schema.optionalKey(Schema.Literal(true)),
  /** `max-stale` (request): accept stale responses, optionally up to a limit. */
  maxStale: Schema.optionalKey(Schema.Union([Schema.Literal(true), Schema.Duration])),
  /** `min-fresh` (request). */
  minFresh: Schema.optionalKey(Schema.Duration),
  /** `only-if-cached` (request). */
  onlyIfCached: Schema.optionalKey(Schema.Literal(true)),
  /** `s-maxage` (response): `max-age` for shared caches. */
  sMaxage: Schema.optionalKey(Schema.Duration),
  /** `private` (response); optionally limited to some header fields. */
  private: Schema.optionalKey(FieldNames),
  /** `public` (response). */
  public: Schema.optionalKey(Schema.Literal(true)),
  /** `must-revalidate` (response). */
  mustRevalidate: Schema.optionalKey(Schema.Literal(true)),
  /** `proxy-revalidate` (response). */
  proxyRevalidate: Schema.optionalKey(Schema.Literal(true)),
  /** `must-understand` (response). */
  mustUnderstand: Schema.optionalKey(Schema.Literal(true)),
  /** `immutable` (response, RFC 8246). */
  immutable: Schema.optionalKey(Schema.Literal(true)),
  /** `stale-while-revalidate` (response, RFC 5861). */
  staleWhileRevalidate: Schema.optionalKey(Schema.Duration),
  /** `stale-if-error` (RFC 5861). */
  staleIfError: Schema.optionalKey(Schema.Duration),
})

/** The directives of a `Cache-Control` header. */
export interface CacheControl extends Schema.Schema.Type<typeof CacheControl> {}

const DURATIONS = ["maxAge", "minFresh", "sMaxage", "staleWhileRevalidate", "staleIfError"] as const

const fromStd = (cc: StdCacheControl): CacheControl => {
  const out: Record<string, unknown> = { ...cc }
  for (const key of DURATIONS) {
    const value = cc[key]
    if (typeof value === "number") out[key] = Duration.seconds(value)
  }
  if (typeof cc.maxStale === "number") out.maxStale = Duration.seconds(cc.maxStale)
  return out as CacheControl
}

const seconds = (d: Duration.Duration): number => Math.floor(Duration.toSeconds(d))

const toStd = (cc: CacheControl): StdCacheControl => {
  const out: Record<string, unknown> = { ...cc }
  for (const key of DURATIONS) {
    const value = cc[key]
    if (value !== undefined) out[key] = seconds(value)
  }
  if (cc.maxStale !== undefined && cc.maxStale !== true) out.maxStale = seconds(cc.maxStale)
  return out as StdCacheControl
}

/**
 * Parses a `Cache-Control` header value. Never fails: an absent or empty
 * header gives `{}`, and invalid directives are skipped.
 */
export const parse = (value: string | null | undefined): CacheControl => fromStd(parseCacheControl(value ?? null))

/**
 * Formats directives as a `Cache-Control` value. Fails when a field name in
 * `no-cache` or `private` is not a valid token, or a duration is not finite.
 *
 * ```ts
 * import { Duration, Result } from "effect"
 * import { format } from "@mikepage/flareosaur/http/cache-control"
 *
 * Result.getOrThrow(format({ noCache: true, maxAge: Duration.zero })) // "max-age=0, no-cache"
 * ```
 */
export const format = (cc: CacheControl): Result.Result<string, CacheControlError> => {
  try {
    return Result.succeed(formatCacheControl(toStd(cc)))
  } catch (cause) {
    return Result.fail(new CacheControlError({ message: message(cause), cause }))
  }
}

/** A Schema between a `Cache-Control` header value and its directives. */
export const CacheControlFromString: Schema.decodeTo<typeof CacheControl, Schema.String> = Schema.String.pipe(
  Schema.decodeTo(CacheControl, fromResults((s: string) => Result.succeed(parse(s)), format)),
)

/** Reads and parses the `Cache-Control` header of a message or `Headers`. */
export const get = (input: HeadersInput): CacheControl => parse(Option.getOrNull(header(input, "cache-control")))

/** The `Cache-Control` directives of the current `HttpServerRequest`. */
export const fromRequest: Effect.Effect<CacheControl, never, HttpServerRequest.HttpServerRequest> = HttpServerRequest
  .HttpServerRequest.useSync(get)

/** Sets the `Cache-Control` header of a response. */
export const set: {
  (cc: CacheControl): (self: HttpServerResponse.HttpServerResponse) => Effect.Effect<HttpServerResponse.HttpServerResponse, CacheControlError>
  (self: HttpServerResponse.HttpServerResponse, cc: CacheControl): Effect.Effect<HttpServerResponse.HttpServerResponse, CacheControlError>
} = Function.dual(
  2,
  (self: HttpServerResponse.HttpServerResponse, cc: CacheControl) =>
    Effect.map(Effect.fromResult(format(cc)), (value) => HttpServerResponse.setHeader(self, "cache-control", value)),
)

/** Sets the `Cache-Control` header of Effect `Headers`. */
export const setHeaders: {
  (cc: CacheControl): (self: Headers.Headers) => Result.Result<Headers.Headers, CacheControlError>
  (self: Headers.Headers, cc: CacheControl): Result.Result<Headers.Headers, CacheControlError>
} = Function.dual(
  2,
  (self: Headers.Headers, cc: CacheControl) => Result.map(format(cc), (value) => Headers.set(self, "cache-control", value)),
)
