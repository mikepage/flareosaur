// Copyright 2026 the flareosaur authors. MIT license.
import { Clock, Effect, Fiber, Ref } from "effect"
import { describe, it } from "./mod.ts"
import { assert, assertEquals } from "../assert/mod.ts"
import * as Time from "./Time.ts"

describe("Time", () => {
  it.effect("tick moves the clock and runs sleeps", () =>
    Effect.gen(function*() {
      assertEquals(yield* Time.now, 0)
      const fiber = yield* Effect.forkChild(Effect.sleep("1 second").pipe(Effect.as("done")))
      yield* Time.tick("500 millis")
      assertEquals(fiber.pollUnsafe(), undefined)
      yield* Time.tick("500 millis")
      assertEquals(yield* Fiber.join(fiber), "done")
      assertEquals(yield* Time.now, 1000)
      yield* Time.tick()
      assertEquals(yield* Time.now, 1000)
    }))

  it.effect("advanceBy and advanceTo", () =>
    Effect.gen(function*() {
      yield* Time.advanceBy("1 minute")
      assertEquals(yield* Clock.currentTimeMillis, 60_000)
      yield* Time.advanceTo(new Date(120_000))
      assertEquals(yield* Time.now, 120_000)
      yield* Time.advanceTo(180_000)
      assertEquals(yield* Time.now, 180_000)
    }))

  it.effect("runMicrotasks lets ready fibers run without moving time", () =>
    Effect.gen(function*() {
      const ran = yield* Ref.make(false)
      yield* Effect.forkChild(Ref.set(ran, true))
      yield* Time.runMicrotasks
      assert(yield* Ref.get(ran))
      assertEquals(yield* Time.now, 0)
    }))

  it.effect("re-exports TestClock operations", () =>
    Effect.gen(function*() {
      yield* Time.adjust("1 second")
      yield* Time.setTime(5000)
      assertEquals(yield* Time.now, 5000)
      const real = yield* Time.live(Clock.currentTimeMillis)
      assert(real > 1_000_000_000_000)
      const real2 = yield* Time.withLive(Clock.currentTimeMillis)
      assert(real2 >= real)
      yield* Time.testClockWith((clock) => clock.adjust("1 second"))
      assertEquals(yield* Time.now, 6000)
    }))

  it.effect("provides a fresh clock with layer", () =>
    Effect.gen(function*() {
      yield* Time.tick("1 hour")
      const inner = yield* Time.now.pipe(Effect.provide(Time.layer()))
      assertEquals(inner, 0)
      assertEquals(typeof Time.make, "function")
    }))
})
