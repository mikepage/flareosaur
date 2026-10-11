// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * A double-ended queue on a growable ring buffer, from
 * `@std/data-structures`, with `Option` results.
 *
 * Push and pop at both ends are amortised O(1); `at` is O(1). Every method
 * that std answers with `undefined` or `-1` (`popFront`, `peekBack`, `at`,
 * `find`, `findIndex`, `removeAt`, ...) returns an `Option`. For a queue
 * shared between fibers, use Effect's `Queue`.
 *
 * ```ts
 * import { Deque } from "@mikepage/flareosaur/data-structures/deque"
 *
 * const deque = new Deque([2, 3])
 * deque.pushFront(1)
 * deque.pushBack(4)
 * deque.popFront() // Option.some(1)
 * deque.peekBack() // Option.some(4)
 * deque.at(-1) // Option.some(4)
 * ```
 *
 * @module
 */

import { Option } from "effect"
import { Deque as StdDeque } from "./_std/deque.ts"
import { Structure } from "./_base.ts"

/** A double-ended queue. */
export class Deque<A> extends Structure implements Iterable<A> {
  readonly #deque: StdDeque<A>

  /** Creates a deque, optionally holding `values` front to back. */
  constructor(values?: Iterable<A>) {
    super()
    this.#deque = new StdDeque<A>(values)
  }

  /** Creates a deque holding `values` front to back. */
  static from<A>(values: Iterable<A>): Deque<A> {
    return new Deque(values)
  }

  /** The number of values. */
  get length(): number {
    return this.#deque.length
  }

  /** Whether the deque is empty. */
  isEmpty(): boolean {
    return this.#deque.isEmpty()
  }

  /** Adds values to the back; returns the new length. */
  pushBack(value: A, ...rest: ReadonlyArray<A>): number {
    return this.#deque.pushBack(value, ...rest)
  }

  /** Adds values to the front, keeping their order; returns the new length. */
  pushFront(value: A, ...rest: ReadonlyArray<A>): number {
    return this.#deque.pushFront(value, ...rest)
  }

  /** Removes and returns the back value. */
  popBack(): Option.Option<A> {
    return this.#deque.isEmpty() ? Option.none() : Option.some(this.#deque.popBack() as A)
  }

  /** Removes and returns the front value. */
  popFront(): Option.Option<A> {
    return this.#deque.isEmpty() ? Option.none() : Option.some(this.#deque.popFront() as A)
  }

  /** The front value. */
  peekFront(): Option.Option<A> {
    return this.#deque.isEmpty() ? Option.none() : Option.some(this.#deque.peekFront() as A)
  }

  /** The back value. */
  peekBack(): Option.Option<A> {
    return this.#deque.isEmpty() ? Option.none() : Option.some(this.#deque.peekBack() as A)
  }

  #index(index: number): Option.Option<number> {
    const i = Math.trunc(index) < 0 ? this.#deque.length + Math.trunc(index) : Math.trunc(index)
    return i >= 0 && i < this.#deque.length ? Option.some(i) : Option.none()
  }

  /** The value at `index`; negative indexes count from the back. */
  at(index: number): Option.Option<A> {
    return Option.map(this.#index(index), (i) => this.#deque.at(i) as A)
  }

  /** The index of the first value matching `predicate`. */
  findIndex(predicate: (value: A, index: number) => boolean): Option.Option<number> {
    const i = this.#deque.findIndex(predicate)
    return i === -1 ? Option.none() : Option.some(i)
  }

  /** The first value matching `predicate`. */
  find(predicate: (value: A, index: number) => boolean): Option.Option<A> {
    return Option.map(this.findIndex(predicate), (i) => this.#deque.at(i) as A)
  }

  /** Whether the deque holds `value` (SameValueZero). */
  includes(value: A): boolean {
    return this.#deque.includes(value)
  }

  /** Removes and returns the first value matching `predicate`. */
  removeFirst(predicate: (value: A, index: number) => boolean): Option.Option<A> {
    return Option.map(this.findIndex(predicate), (i) => this.#deque.removeAt(i) as A)
  }

  /** Removes and returns the value at `index`; negative indexes count from the back. */
  removeAt(index: number): Option.Option<A> {
    return Option.map(this.#index(index), (i) => this.#deque.removeAt(i) as A)
  }

  /** Keeps only the values matching `predicate`, in place. */
  retain(predicate: (value: A, index: number) => boolean): void {
    this.#deque.retain(predicate)
  }

  /** Removes every value. */
  clear(): void {
    this.#deque.clear()
  }

  /** The values front to back. */
  toArray(): Array<A> {
    return this.#deque.toArray()
  }

  /** The values back to front. */
  reversed(): IterableIterator<A> {
    return this.#deque.reversed()
  }

  /** The values front to back. */
  [Symbol.iterator](): IterableIterator<A> {
    return this.#deque[Symbol.iterator]()
  }

  toJSON(): unknown {
    return { _id: "Deque", values: this.toArray() }
  }
}
