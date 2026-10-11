// Copyright 2026 the flareosaur authors. MIT license.

/**
 * The Workers Cache API (`caches.default`) with Effect.
 *
 * {@linkcode cached} serves a response from the cache when it can, and
 * otherwise runs the effect, returns its response and stores a copy in the
 * background with `ctx.waitUntil`. Only `GET` requests and `200` responses
 * are cached, and only if the response does not say `no-store` or `private`.
 *
 * ```ts no-assert
 * import { Effect } from "effect"
 * import * as Cache from "@mikepage/flareosaur/workers/cache"
 * import * as Worker from "@mikepage/flareosaur/workers/worker"
 *
 * export default Worker.make({
 *   fetch: (request) =>
 *     Cache.cached(request, Effect.succeed(new Response("expensive")), { maxAge: "5 minutes" }),
 * })
 * ```
 *
 * @module
 */

import { Context, Duration, Effect, Layer, Option, Schema } from "effect"
import { ExecutionContext, waitUntil } from "./Worker.ts"

/** The parts of a Workers `Cache` this module uses. */
export interface CacheLike {
  match(request: Request | string): Promise<Response | undefined>
  put(request: Request | string, response: Response): Promise<void>
  delete(request: Request | string): Promise<boolean>
}

/** A cache operation failed. */
export class CacheError extends Schema.TaggedError<CacheError>()("CacheError", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

/** The cache to use; defaults to `caches.default`. */
export class HttpCache extends Context.Service<HttpCache, CacheLike>()("@mikepage/flareosaur/workers/Cache/HttpCache") {
  /** Uses `caches.default`, the cache of the zone the Worker runs on. */
  static readonly layerDefault: Layer.Layer<HttpCache> = Layer.sync(
    HttpCache,
    () => (globalThis as unknown as { caches: { default: CacheLike } }).caches.default,
  )
  /** Uses a named cache from `caches.open(name)`. */
  static readonly layerNamed = (name: string): Layer.Layer<HttpCache, CacheError> =>
    Layer.effect(
      HttpCache,
      Effect.tryPromise({
        try: () => (globalThis as unknown as { caches: { open(name: string): Promise<CacheLike> } }).caches.open(name),
        catch: (cause) => new CacheError({ message: `caches.open(${name}) failed`, cause }),
      }),
    )
}

const tryCache = <A>(message: string, f: () => Promise<A>) =>
  Effect.tryPromise({ try: f, catch: (cause) => new CacheError({ message, cause }) })

const defaultCache = (): CacheLike => (globalThis as unknown as { caches: { default: CacheLike } }).caches.default

// The provided HttpCache, or caches.default.
const currentCache: Effect.Effect<CacheLike> = Effect.map(Effect.serviceOption(HttpCache), Option.getOrElse(defaultCache))

/** Looks a request up in the cache. */
export const match = (request: Request | string): Effect.Effect<Option.Option<Response>, CacheError> =>
  Effect.flatMap(currentCache, (cache) =>
    Effect.map(tryCache("cache.match failed", () => cache.match(request)), (r) => Option.fromNullishOr(r)))

/** Removes a request from the cache. */
export const remove = (request: Request | string): Effect.Effect<boolean, CacheError> =>
  Effect.flatMap(currentCache, (cache) => tryCache("cache.delete failed", () => cache.delete(request)))

/** Options for {@linkcode cached}. */
export interface CachedOptions {
  /** Sets `Cache-Control: public, max-age=...` on the stored copy. */
  readonly maxAge?: Duration.Input | undefined
}

const cacheable = (request: Request, response: Response): boolean =>
  request.method === "GET" && response.status === 200 &&
  !/no-store|private/.test(response.headers.get("cache-control") ?? "")

/**
 * Serves `request` from the cache, or runs `effect` and stores its response.
 * Responses carry `x-cache: HIT` or `x-cache: MISS`.
 */
export const cached = <E, R>(
  request: Request,
  effect: Effect.Effect<Response, E, R>,
  options?: CachedOptions,
): Effect.Effect<Response, E | CacheError, R | ExecutionContext> =>
  Effect.gen(function*() {
    const hit = yield* match(request)
    if (Option.isSome(hit)) {
      const response = new Response(hit.value.body, hit.value)
      response.headers.set("x-cache", "HIT")
      return response
    }
    const response = yield* effect
    if (!cacheable(request, response)) return response
    const copy = new Response(response.clone().body, response)
    if (options?.maxAge !== undefined) {
      const seconds = Math.round(Duration.toSeconds(Duration.fromInputUnsafe(options.maxAge)))
      copy.headers.set("cache-control", `public, max-age=${seconds}`)
    }
    const cache = yield* currentCache
    yield* waitUntil(tryCache("cache.put failed", () => cache.put(request, copy)))
    const result = new Response(response.body, response)
    result.headers.set("x-cache", "MISS")
    return result
  })
