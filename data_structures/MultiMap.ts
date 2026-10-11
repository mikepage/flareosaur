// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * A map from each key to a list of values, from `@std/data-structures`, with
 * `Option` lookups.
 *
 * Values keep their insertion order per key and may repeat. Keys are compared
 * like `Map` keys (SameValueZero). For an immutable grouping, Effect's
 * `Array.groupBy` returns a record of non-empty arrays.
 *
 * ```ts
 * import { MultiMap } from "@mikepage/flareosaur/data-structures/multi-map"
 *
 * const tags = new MultiMap<string, string>()
 * tags.add("post-1", "effect").add("post-1", "deno")
 * tags.get("post-1") // Option.some(["effect", "deno"])
 * tags.get("post-2") // Option.none()
 * MultiMap.groupBy(["apple", "avocado", "banana"], (s) => s[0]).get("a") // Option.some(["apple", "avocado"])
 * ```
 *
 * @module
 */

import { Option } from "effect"
import { MultiMap as StdMultiMap } from "./_std/unstable_multimap.ts"
import { Structure } from "./_base.ts"

/** A map from keys to lists of values. */
export class MultiMap<K, V> extends Structure implements Iterable<[K, V]> {
  readonly #map: StdMultiMap<K, V>

  /** Creates a multimap, optionally from `[key, value]` entries. */
  constructor(entries?: Iterable<readonly [K, V]>) {
    super()
    this.#map = new StdMultiMap<K, V>(entries)
  }

  /** Groups `items` by the key `f` returns. */
  static groupBy<K, A>(items: Iterable<A>, f: (item: A, index: number) => K): MultiMap<K, A> {
    const map = new MultiMap<K, A>()
    let index = 0
    for (const item of items) map.add(f(item, index++), item)
    return map
  }

  /** The number of keys. */
  get size(): number {
    return this.#map.size
  }

  /** The number of values, over all keys. */
  get valueCount(): number {
    return this.#map.valueCount
  }

  /** Adds `value` to the values of `key`. */
  add(key: K, value: V): this {
    this.#map.add(key, value)
    return this
  }

  /** A copy of the values of `key`. */
  get(key: K): Option.Option<Array<V>> {
    const values = this.#map.get(key)
    return values === undefined ? Option.none() : Option.some(values)
  }

  /** Whether `key` has values. */
  has(key: K): boolean {
    return this.#map.has(key)
  }

  /** Whether `key` has `value` (SameValueZero). */
  hasEntry(key: K, value: V): boolean {
    return this.#map.hasEntry(key, value)
  }

  /** Removes `key` and all its values; returns whether it was present. */
  delete(key: K): boolean {
    return this.#map.delete(key)
  }

  /** Removes one occurrence of `value` from `key`; returns whether it was present. */
  deleteEntry(key: K, value: V): boolean {
    return this.#map.deleteEntry(key, value)
  }

  /** Removes everything. */
  clear(): void {
    this.#map.clear()
  }

  /** Every `[key, value]` pair, grouped by key. */
  entries(): IterableIterator<[K, V]> {
    return this.#map.entries()
  }

  /** Every key with a copy of its values. */
  groups(): IterableIterator<[K, Array<V>]> {
    return this.#map.groups()
  }

  /** The keys. */
  keys(): IterableIterator<K> {
    return this.#map.keys()
  }

  /** Every value, grouped by key. */
  values(): IterableIterator<V> {
    return this.#map.values()
  }

  /** A `Map` from each key to a copy of its values. */
  toMap(): Map<K, Array<V>> {
    return this.#map.toMap()
  }

  /** Every `[key, value]` pair. */
  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.#map[Symbol.iterator]()
  }

  toJSON(): unknown {
    return { _id: "MultiMap", groups: Array.from(this.#map.groups()) }
  }
}
