// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * A counter over a fixed number of segments, for sliding-window counts such
 * as "requests in the last minute", from `@std/data-structures`.
 *
 * {@linkcode RollingCounter.increment} adds to the newest segment;
 * {@linkcode RollingCounter.rotate} starts a new segment and drops the
 * oldest. What Effect adds is time: {@linkcode RollingCounter.rotateEvery}
 * rotates on a schedule in a fiber tied to the current `Scope`, using
 * `Clock`, so the window moves by itself and tests drive it with `TestClock`.
 *
 * ```ts
 * import { Effect } from "effect"
 * import { RollingCounter } from "@mikepage/flareosaur/data-structures/rolling-counter"
 *
 * const program = Effect.scoped(Effect.gen(function*() {
 *   const requests = new RollingCounter(60) // 60 one-second segments
 *   yield* requests.rotateEvery("1 second")
 *   requests.increment()
 *   return requests.total // requests in the last minute
 * }))
 * ```
 *
 * @module
 */

import { type Duration, Effect, Option, type Scope } from "effect"
import { RollingCounter as StdRollingCounter, type RollingCounterSnapshot } from "./_std/unstable_rolling_counter.ts"
import { Structure } from "./_base.ts"

export type { RollingCounterSnapshot }

/** A counter over a ring of segments. */
export class RollingCounter extends Structure implements Iterable<number> {
  readonly #counter: StdRollingCounter

  /** Creates a counter of `segmentCount` segments; it must be a positive integer, or this throws a `RangeError`. */
  constructor(segmentCount: number) {
    super()
    this.#counter = new StdRollingCounter(segmentCount)
  }

  /** Restores a counter from a {@linkcode RollingCounter.toJSON} snapshot. */
  static fromSnapshot(snapshot: RollingCounterSnapshot): RollingCounter {
    const counter = new RollingCounter(snapshot.segments.length)
    counter.#counter.clear()
    for (const count of snapshot.segments) {
      counter.#counter.rotate()
      counter.#counter.increment(count)
    }
    return counter
  }

  /** Adds `n` (default 1, a non-negative integer) to the newest segment; returns the new total. */
  increment(n = 1): number {
    return this.#counter.increment(n)
  }

  /** Moves the window `steps` segments forward (default 1); returns the count dropped. */
  rotate(steps = 1): number {
    return this.#counter.rotate(steps)
  }

  /**
   * Rotates one segment every `interval`, in a fiber that stops when the
   * current scope closes.
   *
   * On Workers, keep that scope inside one request, or run it in a Durable
   * Object. Its sleep is a timer of the request that started it: in a scope
   * that outlives the request, such as a Worker's shared layer, the fiber
   * stops when that request ends.
   */
  rotateEvery(interval: Duration.Input): Effect.Effect<void, never, Scope.Scope> {
    return Effect.sleep(interval).pipe(
      Effect.andThen(Effect.sync(() => this.#counter.rotate())),
      Effect.forever,
      Effect.forkScoped({ startImmediately: true }),
      Effect.asVoid,
    )
  }

  /** The count of the newest segment. */
  get current(): number {
    return this.#counter.current
  }

  /** The count over all segments. */
  get total(): number {
    return this.#counter.total
  }

  /** The number of segments. */
  get segmentCount(): number {
    return this.#counter.segmentCount
  }

  /** The count of the segment at `index`, oldest first; negative indexes count from the newest. */
  at(index: number): Option.Option<number> {
    const value = this.#counter.at(index)
    return value === undefined ? Option.none() : Option.some(value)
  }

  /** Sets every segment to 0. */
  clear(): void {
    this.#counter.clear()
  }

  /** The segment counts, oldest first. */
  toArray(): Array<number> {
    return this.#counter.toArray()
  }

  /** The segment counts, oldest first. */
  [Symbol.iterator](): IterableIterator<number> {
    return this.#counter[Symbol.iterator]()
  }

  /** A snapshot of the segments, oldest first, for {@linkcode RollingCounter.fromSnapshot}. */
  toJSON(): RollingCounterSnapshot {
    return this.#counter.toJSON()
  }
}
