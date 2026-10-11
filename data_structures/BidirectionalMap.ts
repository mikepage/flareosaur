// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * A one-to-one map that looks up both ways, from `@std/data-structures`,
 * with `Option` lookups.
 *
 * Setting a key or a value that is already present replaces the old pair, so
 * keys and values stay unique. Keys and values are compared like `Map` keys
 * (SameValueZero).
 *
 * ```ts
 * import { BidirectionalMap } from "@mikepage/flareosaur/data-structures/bidirectional-map"
 *
 * const map = new BidirectionalMap([["one", 1]])
 * map.get("one") // Option.some(1)
 * map.getReverse(1) // Option.some("one")
 * map.set("uno", 1) // replaces "one"
 * map.has("one") // false
 * ```
 *
 * @module
 */

import { Option } from "effect"
import { BidirectionalMap as StdBidirectionalMap } from "./_std/unstable_bidirectional_map.ts"
import { Structure } from "./_base.ts"

/** A map whose values are unique and can be looked up by value. */
export class BidirectionalMap<K, V> extends Structure implements Iterable<[K, V]> {
  readonly #map: StdBidirectionalMap<K, V>

  /** Creates a map, optionally from entries (later entries replace earlier ones). */
  constructor(entries?: Iterable<readonly [K, V]>) {
    super()
    this.#map = new StdBidirectionalMap<K, V>(entries)
  }

  /** The number of pairs. */
  get size(): number {
    return this.#map.size
  }

  /** The value for `key`. */
  get(key: K): Option.Option<V> {
    return this.#map.has(key) ? Option.some(this.#map.get(key) as V) : Option.none()
  }

  /** The key for `value`. */
  getReverse(value: V): Option.Option<K> {
    return this.#map.hasReverse(value) ? Option.some(this.#map.getReverse(value) as K) : Option.none()
  }

  /** Whether `key` is present. */
  has(key: K): boolean {
    return this.#map.has(key)
  }

  /** Whether `value` is present. */
  hasReverse(value: V): boolean {
    return this.#map.hasReverse(value)
  }

  /** Sets the pair, removing any pair that had the same key or the same value. */
  set(key: K, value: V): this {
    this.#map.set(key, value)
    return this
  }

  /** Removes the pair with `key`; returns whether it was present. */
  delete(key: K): boolean {
    return this.#map.delete(key)
  }

  /** Removes the pair with `value`; returns whether it was present. */
  deleteReverse(value: V): boolean {
    return this.#map.deleteReverse(value)
  }

  /** Removes every pair. */
  clear(): void {
    this.#map.clear()
  }

  /** The keys, in insertion order. */
  keys(): IterableIterator<K> {
    return this.#map.keys()
  }

  /** The values, in insertion order. */
  values(): IterableIterator<V> {
    return this.#map.values()
  }

  /** The pairs, in insertion order. */
  entries(): IterableIterator<[K, V]> {
    return this.#map.entries()
  }

  /** The pairs, in insertion order. */
  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.#map.entries()
  }

  toJSON(): unknown {
    return { _id: "BidirectionalMap", entries: Array.from(this.#map) }
  }
}
