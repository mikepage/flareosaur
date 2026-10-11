// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * Controlling time in Effect tests: Effect's `TestClock`, plus helpers named
 * after `@std/testing/time`'s `FakeTime`.
 *
 * std fakes time by replacing `Date`, `setTimeout` and friends. Effect code
 * reads time from the `Clock` service instead, and `it.effect` provides a
 * `TestClock`, so faking is built in: sleeps, timeouts, schedules and
 * `Clock.currentTimeMillis` all follow the test clock. This module
 * re-exports the `TestClock` operations from `effect/testing/TestClock`
 * (deeply, since the `effect/testing` barrel needs Node) and adds:
 *
 * | std `FakeTime`        | here                              |
 * | --------------------- | --------------------------------- |
 * | `time.tick(ms)`       | {@linkcode tick} (or {@linkcode advanceBy}) |
 * | `time.runMicrotasks()`| {@linkcode runMicrotasks}         |
 * | `time.now`            | {@linkcode now}                   |
 * | `time.now = ms`       | {@linkcode advanceTo}             |
 *
 * ```ts no-assert
 * import { Effect, Fiber } from "effect"
 * import { it } from "@mikepage/flareosaur/testing"
 * import { assertEquals } from "@mikepage/flareosaur/assert"
 * import { now, tick } from "@mikepage/flareosaur/testing/time"
 *
 * it.effect("sleeps finish when the clock moves", () =>
 *   Effect.gen(function*() {
 *     const fiber = yield* Effect.forkChild(Effect.sleep("1 hour").pipe(Effect.as("done")))
 *     yield* tick("1 hour")
 *     assertEquals(yield* Fiber.join(fiber), "done")
 *     assertEquals(yield* now, 3_600_000)
 *   }))
 * ```
 *
 * @module
 */

import { Clock, type Duration, Effect } from "effect"
import * as TestClock from "effect/testing/TestClock"

export { adjust, layer, make, setTime, testClockWith, withLive } from "effect/testing/TestClock"
export type { TestClock } from "effect/testing/TestClock"

/**
 * Moves the test clock forward by `duration` (default 0), running every
 * sleep that ends on the way. `TestClock.adjust`.
 */
export const tick = (duration: Duration.Input = 0): Effect.Effect<void> => TestClock.adjust(duration)

/** Moves the test clock forward by `duration`. The same as {@linkcode tick}. */
export const advanceBy = (duration: Duration.Input): Effect.Effect<void> => TestClock.adjust(duration)

/**
 * Sets the test clock to `time` (epoch milliseconds or a `Date`), running
 * every sleep that ends on the way. `TestClock.setTime`.
 */
export const advanceTo = (time: number | Date): Effect.Effect<void> =>
  TestClock.setTime(typeof time === "number" ? time : time.getTime())

/**
 * Lets every fiber that is ready to run do so, without moving the clock: a
 * forked fiber reaches its first sleep, a callback scheduled for now runs.
 */
export const runMicrotasks: Effect.Effect<void> = TestClock.adjust(0)

/** The current time of the clock, in epoch milliseconds. `Clock.currentTimeMillis`. */
export const now: Effect.Effect<number> = Clock.currentTimeMillis

/** Runs `effect` with the real clock instead of the test clock. `TestClock.withLive`. */
export const live = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => TestClock.withLive(effect)
