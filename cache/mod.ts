// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * Caches from `@std/cache`, on Effect.
 *
 * Effect's `Cache` is the lookup cache: it computes values with an effect,
 * deduplicates concurrent lookups, evicts the least recently used entry past
 * its `capacity` and expires entries after a `timeToLive` measured with
 * `Clock`. This module builds on it and adds the key-value caches std has:
 *
 * - {@linkcode memoize}: std's `memoize` for effectful functions, built on
 *   Effect's `Cache` (keys are the argument lists, compared with `Equal`).
 *   For synchronous functions of one object, Effect's `Function.memoize`
 *   already exists.
 * - {@linkcode LruCache}: a synchronous least-recently-used map. Lookups
 *   return an `Option`.
 * - {@linkcode TtlCache}: a map whose entries expire after a `Duration`.
 *   Time comes from Effect's `Clock`, not timers, so its operations are
 *   Effects and it works with `TestClock`.
 *
 * ```ts
 * import { Effect } from "effect"
 * import { memoize, LruCache, TtlCache } from "@mikepage/flareosaur/cache"
 *
 * const program = Effect.gen(function*() {
 *   const fetchUser = yield* memoize((id: number) => Effect.succeed({ id }), { capacity: 100, timeToLive: "1 minute" })
 *   yield* fetchUser(1) // runs the effect
 *   yield* fetchUser(1) // cached
 *
 *   const lru = new LruCache<string, number>(2)
 *   lru.set("a", 1).set("b", 2).set("c", 3)
 *   lru.get("a") // Option.none(): evicted
 *
 *   const sessions = new TtlCache<string, string>("30 minutes")
 *   yield* sessions.set("token", "user-1")
 *   return yield* sessions.get("token") // Option.some("user-1")
 * })
 * ```
 *
 * @module
 */

import { Cache, Clock, Duration, Effect, Exit, Inspectable, Option, Pipeable } from "effect"
import { LruCache as StdLruCache, type LruCacheEjectionReason } from "./_std/lru_cache.ts"

export type { LruCacheEjectionReason }

// ---------------------------------------------------------------------------
// memoize
// ---------------------------------------------------------------------------

/** Options for {@linkcode memoize}. */
export interface MemoizeOptions<E> {
  /** The most results to keep; the least recently used goes first. Defaults to unbounded. */
  readonly capacity?: number | undefined
  /** How long a result stays cached. Defaults to forever. */
  readonly timeToLive?: Duration.Input | undefined
  /**
   * Whether a failure is cached like a success. Defaults to never: a failed
   * call is retried on the next call. Defects and interruptions are never
   * cached.
   */
  readonly errorIsCacheable?: ((error: E) => boolean) | undefined
}

/**
 * Memoizes an effectful function: calls with equal arguments (by `Equal`,
 * which compares arrays and plain objects structurally) share one result, and
 * concurrent calls share one evaluation. Built on Effect's `Cache`.
 *
 * Returns the memoized function inside an Effect, since every call to
 * `memoize` creates a fresh cache.
 */
export const memoize = <Args extends ReadonlyArray<any>, A, E = never, R = never>(
  fn: (...args: Args) => Effect.Effect<A, E, R>,
  options?: MemoizeOptions<E>,
): Effect.Effect<(...args: Args) => Effect.Effect<A, E, R>> => {
  const ttl = options?.timeToLive === undefined ? Duration.infinity : Duration.fromInputUnsafe(options.timeToLive)
  const errorIsCacheable = options?.errorIsCacheable
  return Effect.map(
    Cache.makeWith((args: Args) => fn(...args), {
      capacity: options?.capacity ?? Number.POSITIVE_INFINITY,
      requireServicesAt: "lookup",
      timeToLive: (exit: Exit.Exit<A, E>) => {
        if (Exit.isSuccess(exit)) return ttl
        const error = Exit.findErrorOption(exit)
        return errorIsCacheable && Option.isSome(error) && errorIsCacheable(error.value) ? ttl : Duration.zero
      },
    }),
    (cache) => (...args: Args) => Cache.get(cache, args),
  )
}

// ---------------------------------------------------------------------------
// LruCache
// ---------------------------------------------------------------------------

/** Options for {@linkcode LruCache}. */
export interface LruCacheOptions<K, V> {
  /**
   * Called when an entry leaves the cache: `"evicted"` past `maxSize`,
   * `"deleted"` by {@linkcode LruCache.delete}, `"cleared"` by
   * {@linkcode LruCache.clear}. The cache cannot be changed from the callback.
   */
  readonly onEject?: ((key: K, value: V, reason: LruCacheEjectionReason) => void) | undefined
}

/**
 * A synchronous least-recently-used cache holding at most `maxSize`
 * entries. Reading an entry with {@linkcode LruCache.get} marks it as
 * recently used; setting a new entry past `maxSize` evicts the least
 * recently used one. Keys are compared like `Map` keys (SameValueZero).
 *
 * For a cache that computes its values with an effect, use Effect's `Cache`,
 * which has the same eviction policy.
 */
export class LruCache<K, V> extends Pipeable.Class implements Inspectable.Inspectable, Iterable<[K, V]> {
  readonly #cache: StdLruCache<K, V>

  /** Creates a cache. `maxSize` must be a positive integer, or the constructor throws a `RangeError`. */
  constructor(maxSize: number, options?: LruCacheOptions<K, V>) {
    super()
    this.#cache = new StdLruCache(maxSize, options?.onEject ? { onEject: options.onEject } : undefined)
  }

  /** The most entries the cache holds. */
  get maxSize(): number {
    return this.#cache.maxSize
  }

  /** The number of entries. */
  get size(): number {
    return this.#cache.size
  }

  /** The value for `key`, marking it as recently used. */
  get(key: K): Option.Option<V> {
    return this.#cache.has(key) ? Option.some(this.#cache.get(key) as V) : Option.none()
  }

  /** The value for `key`, without marking it as recently used. */
  peek(key: K): Option.Option<V> {
    return this.#cache.has(key) ? Option.some(this.#cache.peek(key) as V) : Option.none()
  }

  /** Whether the cache holds `key`. Does not mark it as recently used. */
  has(key: K): boolean {
    return this.#cache.has(key)
  }

  /** Sets `key` to `value` as the most recently used entry, evicting past `maxSize`. */
  set(key: K, value: V): this {
    this.#cache.set(key, value)
    return this
  }

  /** Removes `key`; returns whether it was present. */
  delete(key: K): boolean {
    return this.#cache.delete(key)
  }

  /** Removes every entry. */
  clear(): void {
    this.#cache.clear()
  }

  /** The keys, least recently used first. */
  keys(): IterableIterator<K> {
    return this.#cache.keys()
  }

  /** The values, least recently used first. */
  values(): IterableIterator<V> {
    return this.#cache.values()
  }

  /** The entries, least recently used first. */
  entries(): IterableIterator<[K, V]> {
    return this.#cache.entries()
  }

  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.#cache.entries()
  }

  override toString(): string {
    return Inspectable.toStringUnknown(this.toJSON())
  }

  [Inspectable.NodeInspectSymbol](): unknown {
    return this.toJSON()
  }

  toJSON(): unknown {
    return { _id: "LruCache", maxSize: this.maxSize, entries: Array.from(this.#cache.entries()) }
  }
}

// ---------------------------------------------------------------------------
// TtlCache
// ---------------------------------------------------------------------------

/** Options for {@linkcode TtlCache}. */
export interface TtlCacheOptions<K, V> {
  /** Called when an entry leaves the cache: expired, deleted or cleared. */
  readonly onEject?: ((key: K, value: V) => void) | undefined
  /**
   * Reset an entry's time to live whenever it is read with
   * {@linkcode TtlCache.get}. Defaults to `false`.
   */
  readonly slidingExpiration?: boolean | undefined
}

/** Options for {@linkcode TtlCache.set}. */
export interface TtlCacheSetOptions {
  /** This entry's time to live, instead of the cache's default. */
  readonly timeToLive?: Duration.Input | undefined
  /**
   * A hard limit on the entry's life, measured from now, that sliding
   * expiration cannot extend.
   */
  readonly absoluteExpiration?: Duration.Input | undefined
}

interface TtlEntry<V> {
  readonly value: V
  readonly ttl: number
  readonly deadline: number
  expiresAt: number
}

/**
 * A cache whose entries expire after a time to live. Time is read from
 * Effect's `Clock`, so every operation is an Effect and tests can move time
 * with `TestClock`. There are no timers: expired entries are removed (and
 * `onEject` called) by the next operation that runs after they expire.
 * Keys are compared like `Map` keys (SameValueZero).
 */
export class TtlCache<K, V> extends Pipeable.Class implements Inspectable.Inspectable {
  /** The default time to live of an entry. */
  readonly timeToLive: Duration.Duration
  readonly #entries = new Map<K, TtlEntry<V>>()
  readonly #onEject: ((key: K, value: V) => void) | undefined
  readonly #sliding: boolean
  #nextExpiry = Number.POSITIVE_INFINITY

  /** Creates a cache whose entries live for `timeToLive` unless {@linkcode TtlCache.set} says otherwise. */
  constructor(timeToLive: Duration.Input, options?: TtlCacheOptions<K, V>) {
    super()
    this.timeToLive = Duration.fromInputUnsafe(timeToLive)
    this.#onEject = options?.onEject
    this.#sliding = options?.slidingExpiration ?? false
  }

  // Removes expired entries. #nextExpiry is a lower bound of every expiry.
  #sweep(now: number): void {
    if (now < this.#nextExpiry) return
    let next = Number.POSITIVE_INFINITY
    const expired: Array<[K, V]> = []
    for (const [key, entry] of this.#entries) {
      if (entry.expiresAt <= now) {
        this.#entries.delete(key)
        expired.push([key, entry.value])
      } else if (entry.expiresAt < next) {
        next = entry.expiresAt
      }
    }
    this.#nextExpiry = next
    for (const [key, value] of expired) this.#onEject?.(key, value)
  }

  #withNow<A>(f: (now: number) => A): Effect.Effect<A> {
    return Effect.map(Clock.currentTimeMillis, (now) => {
      this.#sweep(now)
      return f(now)
    })
  }

  /** The value for `key`; with sliding expiration, also resets its time to live. */
  get(key: K): Effect.Effect<Option.Option<V>> {
    return this.#withNow((now) => {
      const entry = this.#entries.get(key)
      if (entry === undefined) return Option.none()
      if (this.#sliding) entry.expiresAt = Math.min(now + entry.ttl, entry.deadline)
      return Option.some(entry.value)
    })
  }

  /** The value for `key`, without resetting its time to live. */
  peek(key: K): Effect.Effect<Option.Option<V>> {
    return this.#withNow(() => {
      const entry = this.#entries.get(key)
      return entry === undefined ? Option.none() : Option.some(entry.value)
    })
  }

  /** Whether the cache holds an unexpired entry for `key`. */
  has(key: K): Effect.Effect<boolean> {
    return this.#withNow(() => this.#entries.has(key))
  }

  /** Sets `key` to `value`, replacing any entry and restarting its time to live. */
  set(key: K, value: V, options?: TtlCacheSetOptions): Effect.Effect<void> {
    const ttl = Duration.toMillis(options?.timeToLive ?? this.timeToLive)
    const absolute = options?.absoluteExpiration === undefined
      ? Number.POSITIVE_INFINITY
      : Duration.toMillis(options.absoluteExpiration)
    return this.#withNow((now) => {
      const deadline = now + absolute
      const expiresAt = Math.min(now + ttl, deadline)
      this.#entries.delete(key)
      this.#entries.set(key, { value, ttl, deadline, expiresAt })
      if (expiresAt < this.#nextExpiry) this.#nextExpiry = expiresAt
    })
  }

  /** Removes `key`; returns whether it was present. */
  delete(key: K): Effect.Effect<boolean> {
    return this.#withNow(() => {
      const entry = this.#entries.get(key)
      if (entry === undefined) return false
      this.#entries.delete(key)
      this.#onEject?.(key, entry.value)
      return true
    })
  }

  /** Removes every entry. */
  clear(): Effect.Effect<void> {
    return this.#withNow(() => {
      const entries = Array.from(this.#entries)
      this.#entries.clear()
      this.#nextExpiry = Number.POSITIVE_INFINITY
      for (const [key, entry] of entries) this.#onEject?.(key, entry.value)
    })
  }

  /** The number of unexpired entries. */
  get size(): Effect.Effect<number> {
    return this.#withNow(() => this.#entries.size)
  }

  /** The unexpired entries, in insertion order. */
  entries(): Effect.Effect<Array<[K, V]>> {
    return this.#withNow(() => Array.from(this.#entries, ([key, entry]) => [key, entry.value] as [K, V]))
  }

  override toString(): string {
    return Inspectable.toStringUnknown(this.toJSON())
  }

  [Inspectable.NodeInspectSymbol](): unknown {
    return this.toJSON()
  }

  toJSON(): unknown {
    return { _id: "TtlCache", timeToLive: this.timeToLive.toJSON(), size: this.#entries.size }
  }
}
