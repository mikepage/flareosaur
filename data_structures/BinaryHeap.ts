// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * A binary heap (priority queue) ordered by an Effect `Order`.
 *
 * {@linkcode BinaryHeap.pop} returns the first value by the order, like
 * Effect's `TxPriorityQueue`: with `Order.Number` the smallest number comes
 * out first, with `Order.flip(Order.Number)` the largest. `peek` and `pop`
 * return an `Option`. Unlike std, iterating a heap does not empty it: it
 * yields a sorted copy; {@linkcode BinaryHeap.drain} empties it.
 *
 * Std's heap is used underneath. Effect's `TxPriorityQueue` is the
 * transactional alternative for sharing a queue between fibers.
 *
 * ```ts
 * import { Order } from "effect"
 * import { BinaryHeap } from "@mikepage/flareosaur/data-structures/binary-heap"
 *
 * const tasks = BinaryHeap.from([{ name: "b", priority: 2 }, { name: "a", priority: 1 }],
 *   Order.mapInput(Order.Number, (t: { name: string; priority: number }) => t.priority))
 * tasks.pop() // Option.some({ name: "a", priority: 1 })
 * tasks.peek() // Option.some({ name: "b", priority: 2 })
 * ```
 *
 * @module
 */

import { Option, type Order } from "effect"
import { BinaryHeap as StdBinaryHeap } from "./_std/binary_heap.ts"
import { Structure } from "./_base.ts"

/** A binary heap that pops values in `order`. */
export class BinaryHeap<A> extends Structure implements Iterable<A> {
  /** The order values come out in. */
  readonly order: Order.Order<A>
  readonly #heap: StdBinaryHeap<A>

  /** Creates an empty heap. */
  constructor(order: Order.Order<A>) {
    super()
    this.order = order
    this.#heap = new StdBinaryHeap<A>(order)
  }

  /** Creates a heap holding `values`. */
  static from<A>(values: Iterable<A>, order: Order.Order<A>): BinaryHeap<A> {
    const heap = new BinaryHeap(order)
    heap.push(...values)
    return heap
  }

  /** The number of values. */
  get length(): number {
    return this.#heap.length
  }

  /** Whether the heap is empty. */
  isEmpty(): boolean {
    return this.#heap.isEmpty()
  }

  /** The first value by the order, without removing it. */
  peek(): Option.Option<A> {
    return this.#heap.isEmpty() ? Option.none() : Option.some(this.#heap.peek() as A)
  }

  /** Removes and returns the first value by the order. */
  pop(): Option.Option<A> {
    return this.#heap.isEmpty() ? Option.none() : Option.some(this.#heap.pop() as A)
  }

  /** Adds values; returns the new length. */
  push(...values: ReadonlyArray<A>): number {
    return this.#heap.push(...values)
  }

  /** Removes every value. */
  clear(): void {
    this.#heap.clear()
  }

  /** Removes and yields every value, in order. */
  *drain(): IterableIterator<A> {
    yield* this.#heap.drain()
  }

  /** The values in heap (not sorted) order. */
  toArray(): Array<A> {
    return this.#heap.toArray()
  }

  /** Yields the values in order, without changing the heap. */
  *[Symbol.iterator](): IterableIterator<A> {
    yield* StdBinaryHeap.from(this.#heap).drain()
  }

  toJSON(): unknown {
    return { _id: "BinaryHeap", values: Array.from(this) }
  }
}
