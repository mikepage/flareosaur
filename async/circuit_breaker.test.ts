// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.
import { Effect, Fiber, Schema } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { describe, it } from "../testing/mod.ts"
import { assert, assertDies, assertEquals, assertFailsWithTag, assertInstanceOf, assertStringIncludes } from "../assert/mod.ts"
import { type CircuitBreakerOptions, type CircuitState, CircuitBreaker } from "./CircuitBreaker.ts"

class Boom extends Schema.TaggedError<Boom>()("Boom", { retriable: Schema.Boolean }) {}

const boom = (retriable = true) => Effect.fail(new Boom({ retriable }))

const run = <A, E>(breaker: CircuitBreaker<any, any>, effect: Effect.Effect<A, E>, times: number) =>
  Effect.forEach(Array.from({ length: times }), () => Effect.exit(breaker.execute(effect)), { discard: true })

const make = (options: CircuitBreakerOptions<any, any>) => CircuitBreaker.make(options)

describe("CircuitBreaker", () => {
  it.effect("starts closed and passes results and errors through", () =>
    Effect.gen(function*() {
      const breaker = yield* make({})
      assertEquals(yield* breaker.state, "closed")
      assertEquals(yield* breaker.execute(Effect.succeed("ok")), "ok")
      yield* assertFailsWithTag(breaker.execute(boom()), "Boom")
    }))

  it.effect("dies on invalid options", () =>
    Effect.gen(function*() {
      assertInstanceOf(yield* assertDies(make({ failureRateThreshold: 0 })), RangeError)
      assertInstanceOf(yield* assertDies(make({ minimumThroughput: 0 })), RangeError)
      assertInstanceOf(yield* assertDies(make({ cooldown: -1 })), RangeError)
      assertInstanceOf(yield* assertDies(make({ window: 0 })), RangeError)
      yield* make({ failureRateThreshold: 1, cooldown: 0, minimumThroughput: 1 })
    }))

  it.effect("opens when the failure rate meets the threshold and the minimum throughput", () =>
    Effect.gen(function*() {
      const breaker = yield* make({ failureRateThreshold: 0.5, minimumThroughput: 4, segmentsPerWindow: 1 })
      yield* run(breaker, Effect.succeed(1), 1)
      yield* run(breaker, boom(), 1)
      assertEquals(yield* breaker.state, "closed")
      yield* run(breaker, Effect.succeed(1), 1)
      yield* run(breaker, boom(), 1)
      assertEquals(yield* breaker.state, "open")
    }))

  it.effect("stays closed below the threshold", () =>
    Effect.gen(function*() {
      const breaker = yield* make({ failureRateThreshold: 0.5, minimumThroughput: 4, segmentsPerWindow: 1 })
      yield* run(breaker, Effect.succeed(1), 3)
      yield* run(breaker, boom(), 1)
      assertEquals(yield* breaker.state, "closed")
    }))

  it.effect("fails with CircuitBreakerOpenError while open, without running the effect", () =>
    Effect.gen(function*() {
      const breaker = yield* make({ failureRateThreshold: 1, minimumThroughput: 1, cooldown: "30 seconds" })
      yield* run(breaker, boom(), 1)
      let ran = false
      const error = yield* assertFailsWithTag(breaker.execute(Effect.sync(() => (ran = true))), "CircuitBreakerOpenError")
      assertStringIncludes(error.message, "Circuit breaker is open: retry after")
      assertEquals(error.remainingCooldownMillis, 30_000)
      assert(!ran)
    }))

  it.effect("evicts old failures as the window moves", () =>
    Effect.gen(function*() {
      const breaker = yield* make({ failureRateThreshold: 0.5, minimumThroughput: 2, window: 1000, segmentsPerWindow: 2 })
      yield* run(breaker, boom(), 1)
      assertEquals(yield* breaker.state, "closed")
      yield* TestClock.adjust(1001)
      yield* run(breaker, Effect.succeed(1), 1)
      yield* run(breaker, boom(), 1)
      assertEquals(yield* breaker.state, "open")
    }))

  it.effect("reports window counts to onFailure", () =>
    Effect.gen(function*() {
      const failures: Array<[number, number]> = []
      const breaker = yield* make({
        failureRateThreshold: 0.8,
        minimumThroughput: 3,
        window: 1000,
        segmentsPerWindow: 2,
        onFailure: (_cause, count, total) => failures.push([count, total]),
      })
      yield* run(breaker, boom(), 2)
      assertEquals(failures, [[1, 1], [2, 2]])
      yield* TestClock.adjust(501)
      yield* run(breaker, Effect.succeed(1), 1)
      assertEquals(yield* breaker.state, "closed")
      yield* TestClock.adjust(500)
      yield* run(breaker, boom(), 1)
      assertEquals(yield* breaker.state, "closed")
      assertEquals(failures[2], [1, 2])
    }))

  it.effect("goes open -> half_open -> closed after the cooldown and successes", () =>
    Effect.gen(function*() {
      const transitions: Array<[CircuitState, CircuitState]> = []
      const events: Array<string> = []
      const breaker = yield* make({
        failureRateThreshold: 1,
        minimumThroughput: 1,
        cooldown: 1000,
        successThreshold: 2,
        onStateChange: (from, to) => transitions.push([from, to]),
        onOpen: () => events.push("open"),
        onHalfOpen: () => events.push("half_open"),
        onClose: () => events.push("close"),
      })
      yield* run(breaker, boom(), 1)
      assertEquals(yield* breaker.state, "open")
      yield* TestClock.adjust(1000)
      assertEquals(yield* breaker.state, "half_open")
      assertEquals(yield* breaker.state, "half_open")
      yield* breaker.execute(Effect.succeed("ok"))
      assertEquals(yield* breaker.state, "half_open")
      yield* breaker.execute(Effect.succeed("ok"))
      assertEquals(yield* breaker.state, "closed")
      assertEquals(transitions, [["closed", "open"], ["open", "half_open"], ["half_open", "closed"]])
      assertEquals(events, ["open", "half_open", "close"])
    }))

  it.effect("reopens from half_open on a failure", () =>
    Effect.gen(function*() {
      const breaker = yield* make({ failureRateThreshold: 1, minimumThroughput: 1, cooldown: 1000 })
      yield* run(breaker, boom(), 1)
      yield* TestClock.adjust(1000)
      yield* run(breaker, boom(), 1)
      assertEquals(yield* breaker.state, "open")
      const error = yield* assertFailsWithTag(breaker.execute(Effect.void), "CircuitBreakerOpenError")
      assertEquals(error.remainingCooldownMillis, 1000)
    }))

  it.effect("limits concurrent trials while half_open", () =>
    Effect.gen(function*() {
      const breaker = yield* make({ failureRateThreshold: 1, minimumThroughput: 1, cooldown: 0, halfOpenMaxConcurrent: 1 })
      yield* run(breaker, boom(), 1)
      const slow = yield* Effect.forkChild(breaker.execute(Effect.sleep("1 second")))
      yield* TestClock.adjust(0)
      const error = yield* assertFailsWithTag(breaker.execute(Effect.void), "CircuitBreakerOpenError")
      assertEquals(error.remainingCooldownMillis, 0)
      yield* TestClock.adjust("1 second")
      yield* Fiber.join(slow)
      yield* breaker.execute(Effect.void)
    }))

  it.effect("counts only the errors isFailure accepts", () =>
    Effect.gen(function*() {
      // uncounted errors still count as requests: 1 failure in 4 requests is 25%
      const breaker = yield* make({
        failureRateThreshold: 0.25,
        minimumThroughput: 1,
        isFailure: (error: Boom) => error.retriable,
      })
      yield* run(breaker, boom(false), 3)
      assertEquals(yield* breaker.state, "closed")
      yield* run(breaker, boom(true), 1)
      assertEquals(yield* breaker.state, "open")
    }))

  it.effect("counts results isResultFailure rejects, and still returns them", () =>
    Effect.gen(function*() {
      const breaker = yield* make({
        failureRateThreshold: 1,
        minimumThroughput: 1,
        isResultFailure: (status: number) => status >= 500,
      })
      assertEquals(yield* breaker.execute(Effect.succeed(200)), 200)
      assertEquals(yield* breaker.state, "closed")
      yield* breaker.forceClose
      assertEquals(yield* breaker.execute(Effect.succeed(503)), 503)
      assertEquals(yield* breaker.state, "open")
    }))

  it.effect("counts defects but not interruptions", () =>
    Effect.gen(function*() {
      const breaker = yield* make({ failureRateThreshold: 1, minimumThroughput: 1 })
      const fiber = yield* Effect.forkChild(breaker.execute(Effect.never))
      yield* TestClock.adjust(0)
      yield* Fiber.interrupt(fiber)
      assertEquals(yield* breaker.state, "closed")
      yield* run(breaker, Effect.die("defect"), 1)
      assertEquals(yield* breaker.state, "open")
    }))

  it.effect("forceOpen, forceClose and reset", () =>
    Effect.gen(function*() {
      const transitions: Array<[CircuitState, CircuitState]> = []
      const breaker = yield* make({ cooldown: 1000, onStateChange: (from, to) => transitions.push([from, to]) })
      yield* breaker.forceOpen
      assertEquals(yield* breaker.state, "open")
      yield* breaker.forceOpen
      yield* breaker.forceClose
      assertEquals(yield* breaker.state, "closed")
      yield* breaker.forceOpen
      yield* breaker.reset
      assertEquals(yield* breaker.state, "closed")
      assertEquals(transitions, [["closed", "open"], ["open", "closed"], ["closed", "open"]])
    }))
})
