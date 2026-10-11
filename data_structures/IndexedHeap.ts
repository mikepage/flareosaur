// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * A priority queue of unique keys whose priorities can change, from
 * `@std/data-structures`, ordered by an Effect `Order` on the priority.
 *
 * {@linkcode IndexedHeap.pop} returns the entry whose priority comes first by
 * the order (with `Order.Number`, the smallest). Keys are looked up in O(1),
 * so priorities can be raised or lowered in O(log n): the building block of
 * Dijkstra's algorithm and similar schedulers. Lookups return an `Option`.
 *
 * ```ts
 * import { Order } from "effect"
 * import { IndexedHeap } from "@mikepage/flareosaur/data-structures/indexed-heap"
 *
 * const queue = new IndexedHeap<string, number>(Order.Number)
 * queue.push("a", 5)
 * queue.push("b", 3)
 * queue.set("a", 1) // decrease a's priority
 * queue.pop() // Option.some({ key: "a", priority: 1 })
 * queue.getPriority("b") // Option.some(3)
 * ```
 *
 * @module
 */

import { Option, type Order } from "effect"
import { type HeapEntry, IndexedHeap as StdIndexedHeap } from "./_std/unstable_indexed_heap.ts"
import { Structure } from "./_base.ts"

export type { HeapEntry }

/** A heap of unique keys with changeable priorities. */
export class IndexedHeap<K, P = number> extends Structure implements Iterable<HeapEntry<K, P>> {
  /** The order of the priorities. */
  readonly order: Order.Order<P>
  readonly #heap: StdIndexedHeap<K, P>

  /**
   * Creates a heap, optionally from `[key, priority]` entries (a repeated key
   * keeps its last priority). A `NaN` priority throws a `RangeError`.
   */
  constructor(order: Order.Order<P>, entries?: Iterable<readonly [K, P]>) {
    super()
    this.order = order
    this.#heap = new StdIndexedHeap<K, P>(null, { compare: order } as any)
    if (entries) for (const [key, priority] of entries) this.#heap.set(key, priority)
  }

  /** The number of entries. */
  get size(): number {
    return this.#heap.size
  }

  /** Whether the heap is empty. */
  isEmpty(): boolean {
    return this.#heap.isEmpty()
  }

  /**
   * Adds `key` with `priority`. Returns `false`, and changes nothing, when
   * the key is already present (std throws); use {@linkcode IndexedHeap.set}
   * to add or update.
   */
  push(key: K, priority: P): boolean {
    if (this.#heap.has(key)) return false
    this.#heap.push(key, priority)
    return true
  }

  /** Adds `key`, or changes its priority. */
  set(key: K, priority: P): void {
    this.#heap.set(key, priority)
  }

  /** Removes and returns the entry whose priority comes first. */
  pop(): Option.Option<HeapEntry<K, P>> {
    return this.#heap.isEmpty() ? Option.none() : Option.some(this.#heap.pop()!)
  }

  /** The entry whose priority comes first, without removing it. */
  peek(): Option.Option<HeapEntry<K, P>> {
    return this.#heap.isEmpty() ? Option.none() : Option.some(this.#heap.peek()!)
  }

  /** The key whose priority comes first. */
  peekKey(): Option.Option<K> {
    return Option.map(this.peek(), (entry) => entry.key)
  }

  /** The priority that comes first. */
  peekPriority(): Option.Option<P> {
    return Option.map(this.peek(), (entry) => entry.priority)
  }

  /** Whether `key` is present. */
  has(key: K): boolean {
    return this.#heap.has(key)
  }

  /** The priority of `key`. */
  getPriority(key: K): Option.Option<P> {
    return this.#heap.has(key) ? Option.some(this.#heap.getPriority(key) as P) : Option.none()
  }

  /** Removes `key`; returns whether it was present. */
  delete(key: K): boolean {
    return this.#heap.delete(key)
  }

  /** Removes every entry. */
  clear(): void {
    this.#heap.clear()
  }

  /** The entries in heap (not sorted) order. */
  toArray(): Array<HeapEntry<K, P>> {
    return this.#heap.toArray()
  }

  /** The entries in heap (not sorted) order, without changing the heap. */
  [Symbol.iterator](): IterableIterator<HeapEntry<K, P>> {
    return this.#heap[Symbol.iterator]()
  }

  toJSON(): unknown {
    return { _id: "IndexedHeap", entries: this.toArray() }
  }
}
