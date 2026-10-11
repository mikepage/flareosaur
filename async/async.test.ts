// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.
import { Duration, Effect, Fiber, Option, pipe, Ref, Result, Schema, Semaphore, Stream } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { describe, it } from "../testing/mod.ts"
import {
  assert,
  assertDies,
  assertEquals,
  assertFailsWithTag,
  assertFalse,
  assertInstanceOf,
  assertNone,
} from "../assert/mod.ts"
import {
  abortable,
  allKeyed,
  allSettledKeyed,
  deadline,
  debounce,
  delay,
  lazy,
  mux,
  poll,
  pooledMap,
  pooledMapSettled,
  retry,
  RetryError,
  retrySchedule,
  semaphore,
  tee,
  throttle,
  toStream,
  waitFor,
} from "./mod.ts"

class Boom extends Schema.TaggedError<Boom>()("Boom", { n: Schema.Number }) {}

// Lets forked fibers run without moving the clock.
const settle = TestClock.adjust(0)

describe("delay", () => {
  it.effect("sleeps on the Clock", () =>
    Effect.gen(function*() {
      const fiber = yield* Effect.forkChild(delay("1 second").pipe(Effect.as("done")))
      yield* TestClock.adjust("999 millis")
      assertEquals(fiber.pollUnsafe(), undefined)
      yield* TestClock.adjust("1 milli")
      assertEquals(yield* Fiber.join(fiber), "done")
    }))
})

describe("deadline", () => {
  it.effect("passes the value through before the deadline", () =>
    Effect.gen(function*() {
      const fiber = yield* Effect.forkChild(Effect.sleep("1 second").pipe(Effect.as(1), deadline("2 seconds")))
      yield* TestClock.adjust("1 second")
      assertEquals(yield* Fiber.join(fiber), 1)
    }))

  it.effect("fails with DeadlineError after the deadline", () =>
    Effect.gen(function*() {
      const fiber = yield* Effect.forkChild(Effect.exit(deadline(Effect.never, "1 second")))
      yield* TestClock.adjust("1 second")
      const exit = yield* Fiber.join(fiber)
      yield* assertFailsWithTag(exit, "DeadlineError")
    }))

  it.effect("keeps the effect's own errors", () =>
    Effect.gen(function*() {
      yield* assertFailsWithTag(deadline(Effect.fail(new Boom({ n: 1 })), "1 second"), "Boom")
    }))
})

describe("abortable", () => {
  it.effect("fails with AbortedError when the signal aborts", () =>
    Effect.gen(function*() {
      const controller = new AbortController()
      const fiber = yield* Effect.forkChild(Effect.exit(abortable(Effect.never, controller.signal)))
      yield* settle
      controller.abort("stop")
      const error = yield* assertFailsWithTag(yield* Fiber.join(fiber), "AbortedError")
      assertEquals(error.reason, "stop")
    }))

  it.effect("fails at once on an aborted signal", () =>
    Effect.gen(function*() {
      const ran = yield* Ref.make(false)
      const error = yield* assertFailsWithTag(
        abortable(Ref.set(ran, true), AbortSignal.abort("early")),
        "AbortedError",
      )
      assertEquals(error.reason, "early")
      assertFalse(yield* Ref.get(ran))
    }))

  it.effect("passes the value through when not aborted", () =>
    Effect.gen(function*() {
      assertEquals(yield* abortable(Effect.succeed(1), new AbortController().signal), 1)
    }))

  it.effect("stops a stream", () =>
    Effect.gen(function*() {
      const controller = new AbortController()
      const fiber = yield* Effect.forkChild(Effect.exit(Stream.runCollect(abortable(Stream.never, controller.signal))))
      yield* settle
      controller.abort()
      yield* assertFailsWithTag(yield* Fiber.join(fiber), "AbortedError")
      assertEquals(yield* Stream.runCollect(abortable(Stream.make(1, 2), new AbortController().signal)), [1, 2])
    }))
})

describe("retry", () => {
  const failingTimes = (times: number) =>
    Effect.gen(function*() {
      const calls = yield* Ref.make(0)
      const effect = Ref.updateAndGet(calls, (n) => n + 1).pipe(
        Effect.flatMap((n) => n <= times ? Effect.fail(new Boom({ n })) : Effect.succeed(n)),
      )
      return { calls, effect }
    })

  it.effect("retries until success with exponential backoff", () =>
    Effect.gen(function*() {
      const { calls, effect } = yield* failingTimes(3)
      const fiber = yield* Effect.forkChild(retry(effect, { jitter: 0, minTimeout: "1 second" }))
      yield* settle
      assertEquals(yield* Ref.get(calls), 1)
      yield* TestClock.adjust("1 second")
      assertEquals(yield* Ref.get(calls), 2)
      yield* TestClock.adjust("1999 millis")
      assertEquals(yield* Ref.get(calls), 2)
      yield* TestClock.adjust("1 milli")
      assertEquals(yield* Ref.get(calls), 3)
      yield* TestClock.adjust("4 seconds")
      assertEquals(yield* Fiber.join(fiber), 4)
    }))

  it.effect("fails with RetryError after maxAttempts", () =>
    Effect.gen(function*() {
      const { calls, effect } = yield* failingTimes(10)
      const fiber = yield* Effect.forkChild(Effect.exit(pipe(effect, retry({ maxAttempts: 3, minTimeout: 10, jitter: 0 }))))
      yield* TestClock.adjust("1 minute")
      const error = yield* assertFailsWithTag(yield* Fiber.join(fiber), "RetryError")
      assertInstanceOf(error, RetryError)
      assertEquals(error.attempts, 3)
      assertEquals((error.cause as Boom).n, 3)
      assertEquals(yield* Ref.get(calls), 3)
    }))

  it.effect("caps delays at maxTimeout", () =>
    Effect.gen(function*() {
      const { calls, effect } = yield* failingTimes(3)
      const fiber = yield* Effect.forkChild(
        retry(effect, { minTimeout: "1 second", maxTimeout: "1 second", multiplier: 10, jitter: 0 }),
      )
      yield* TestClock.adjust("2 seconds")
      assertEquals(yield* Ref.get(calls), 3)
      yield* TestClock.adjust("1 second")
      assertEquals(yield* Fiber.join(fiber), 4)
    }))

  it.effect("does not retry errors isRetriable rejects", () =>
    Effect.gen(function*() {
      const { calls, effect } = yield* failingTimes(5)
      const retried = retry(effect, { isRetriable: (e) => e.n > 1 })
      yield* assertFailsWithTag(retried, "Boom")
      assertEquals(yield* Ref.get(calls), 1)
    }))

  it.effect("jitter shortens delays", () =>
    Effect.gen(function*() {
      const { calls, effect } = yield* failingTimes(1)
      const fiber = yield* Effect.forkChild(retry(effect, { minTimeout: "1 second", jitter: 1 }))
      yield* TestClock.adjust("1 second")
      assertEquals(yield* Fiber.join(fiber), 2)
      assertEquals(yield* Ref.get(calls), 2)
    }))

  it.effect("dies on invalid options", () =>
    Effect.gen(function*() {
      const defect = yield* assertDies(retry(Effect.succeed(1), { maxAttempts: 0 }))
      assertInstanceOf(defect, RangeError)
    }))

  it.effect("retrySchedule works with Effect.retry", () =>
    Effect.gen(function*() {
      const { effect } = yield* failingTimes(2)
      const fiber = yield* Effect.forkChild(Effect.retry(effect, retrySchedule({ jitter: 0, minTimeout: 100 })))
      yield* TestClock.adjust("300 millis")
      assertEquals(yield* Fiber.join(fiber), 3)
    }))
})

describe("debounce", () => {
  it.effect("runs only the last call, after the wait", () =>
    Effect.gen(function*() {
      const calls = yield* Ref.make<Array<number>>([])
      const fn = yield* debounce((n: number) => Ref.update(calls, (c) => [...c, n]), "100 millis")
      fn(1)
      fn(2)
      yield* TestClock.adjust("50 millis")
      fn(3)
      assert(fn.pending)
      yield* TestClock.adjust("99 millis")
      assertEquals(yield* Ref.get(calls), [])
      yield* TestClock.adjust("1 milli")
      assertEquals(yield* Ref.get(calls), [3])
      assertFalse(fn.pending)
    }))

  it.effect("flush runs the pending call now; clear cancels it", () =>
    Effect.gen(function*() {
      const calls = yield* Ref.make<Array<string>>([])
      const fn = yield* debounce((s: string) => Ref.update(calls, (c) => [...c, s]), "1 second")
      fn("a")
      fn.flush()
      yield* settle
      assertEquals(yield* Ref.get(calls), ["a"])
      fn("b")
      fn.clear()
      assertFalse(fn.pending)
      yield* TestClock.adjust("2 seconds")
      assertEquals(yield* Ref.get(calls), ["a"])
      fn.flush()
      yield* settle
      assertEquals(yield* Ref.get(calls), ["a"])
    }))

  it.effect("stops with its scope", () =>
    Effect.gen(function*() {
      const calls = yield* Ref.make(0)
      const fn = yield* Effect.scoped(debounce(() => Ref.update(calls, (n) => n + 1), "1 second"))
      fn()
      yield* TestClock.adjust("2 seconds")
      assertEquals(yield* Ref.get(calls), 0)
    }))
})

describe("throttle", () => {
  it.effect("runs at most once per timeframe", () =>
    Effect.gen(function*() {
      const calls = yield* Ref.make<Array<number>>([])
      const fn = yield* throttle((n: number) => Ref.update(calls, (c) => [...c, n]), "100 millis")
      fn(1)
      yield* settle
      assert(fn.throttling)
      assertEquals(fn.lastExecution, Option.some(0))
      fn(2)
      yield* TestClock.adjust("100 millis")
      fn(3)
      yield* TestClock.adjust("1 milli")
      fn(4)
      yield* settle
      assertEquals(yield* Ref.get(calls), [1, 4])
    }))

  it.effect("ensureLastCall runs the last throttled call", () =>
    Effect.gen(function*() {
      const calls = yield* Ref.make<Array<number>>([])
      const fn = yield* throttle((n: number) => Ref.update(calls, (c) => [...c, n]), "100 millis", { ensureLastCall: true })
      fn(1)
      yield* settle
      fn(2)
      fn(3)
      yield* TestClock.adjust("100 millis")
      assertEquals(yield* Ref.get(calls), [1, 3])
    }))

  it.effect("does not run while a previous run is in flight", () =>
    Effect.gen(function*() {
      const calls = yield* Ref.make(0)
      const fn = yield* throttle(() => Ref.update(calls, (n) => n + 1).pipe(Effect.andThen(Effect.sleep("1 second"))), 0)
      fn()
      yield* settle
      fn()
      assert(fn.throttling)
      yield* TestClock.adjust("1 second")
      assert(fn.throttling) // the timeframe (0) includes the instant the run ended, as in std
      yield* TestClock.adjust("1 milli")
      assertFalse(fn.throttling)
      fn()
      yield* settle
      assertEquals(yield* Ref.get(calls), 2)
    }))

  it.effect("flush and clear", () =>
    Effect.gen(function*() {
      const calls = yield* Ref.make<Array<number>>([])
      const fn = yield* throttle((n: number) => Ref.update(calls, (c) => [...c, n]), "1 second", { ensureLastCall: true })
      fn(1)
      yield* settle
      fn(2)
      fn.flush()
      yield* settle
      assertEquals(yield* Ref.get(calls), [1, 2])
      fn.clear()
      assertFalse(fn.throttling)
      assertNone(fn.lastExecution)
      fn(3)
      yield* settle
      assertEquals(yield* Ref.get(calls), [1, 2, 3])
    }))

  it.effect("accepts an adaptive timeframe", () =>
    Effect.gen(function*() {
      const calls = yield* Ref.make(0)
      const fn = yield* throttle(
        () => Ref.update(calls, (n) => n + 1).pipe(Effect.andThen(Effect.sleep("100 millis"))),
        (previous) => Duration.times(previous, 2),
      )
      fn()
      yield* TestClock.adjust("100 millis")
      fn()
      yield* TestClock.adjust("200 millis")
      fn()
      yield* settle
      assertEquals(yield* Ref.get(calls), 1)
      yield* TestClock.adjust("1 milli")
      fn()
      yield* settle
      assertEquals(yield* Ref.get(calls), 2)
    }))
})

describe("pooledMap", () => {
  it.effect("maps with bounded concurrency, in input order", () =>
    Effect.gen(function*() {
      const running = yield* Ref.make(0)
      const peak = yield* Ref.make(0)
      const f = (n: number) =>
        Ref.updateAndGet(running, (r) => r + 1).pipe(
          Effect.tap((r) => Ref.update(peak, (p) => Math.max(p, r))),
          Effect.andThen(Effect.sleep(Duration.millis(10 * (4 - n)))),
          Effect.andThen(Ref.update(running, (r) => r - 1)),
          Effect.as(n * 2),
        )
      const fiber = yield* Effect.forkChild(Stream.runCollect(pooledMap([1, 2, 3], f, 2)))
      yield* TestClock.adjust("1 second")
      assertEquals(yield* Fiber.join(fiber), [2, 4, 6])
      assertEquals(yield* Ref.get(peak), 2)
    }))

  it.effect("accepts async iterables and fails with the first error", () =>
    Effect.gen(function*() {
      async function* gen() {
        yield 1
        yield 2
      }
      assertEquals(yield* Stream.runCollect(pooledMap(gen(), (n) => Effect.succeed(n + 1), { concurrency: 2 })), [2, 3])
      yield* assertFailsWithTag(
        Stream.runCollect(pooledMap([1, 2], (n) => n === 2 ? Effect.fail(new Boom({ n })) : Effect.succeed(n), 1)),
        "Boom",
      )
      async function* broken(): AsyncGenerator<number> {
        throw new Error("broken")
      }
      yield* assertFailsWithTag(Stream.runCollect(pooledMap(broken(), Effect.succeed, 1)), "AsyncIterableError")
    }))

  it.effect("pooledMapSettled emits every outcome", () =>
    Effect.gen(function*() {
      const results = yield* Stream.runCollect(
        pooledMapSettled([1, 2, 3], (n) => n === 2 ? Effect.fail(new Boom({ n })) : Effect.succeed(n), 2),
      )
      assertEquals(results.map(Result.isSuccess), [true, false, true])
    }))
})

describe("mux and tee", () => {
  it.effect("mux merges sources", () =>
    Effect.gen(function*() {
      async function* gen() {
        yield 3
      }
      const values = yield* Stream.runCollect(mux<number>([1, 2], gen(), Stream.make(4)))
      assertEquals([...values].sort(), [1, 2, 3, 4])
    }))

  it.effect("tee gives every branch every element", () =>
    Effect.gen(function*() {
      const [a, b] = yield* tee(Stream.make(1, 2, 3))
      const [left, right] = yield* Effect.all([Stream.runCollect(a), Stream.runCollect(b)], { concurrency: "unbounded" })
      assertEquals(left, [1, 2, 3])
      assertEquals(right, [1, 2, 3])
      const branches = yield* tee([1, 2], 3, { capacity: "unbounded" })
      const all = yield* Effect.all(branches.map(Stream.runCollect), { concurrency: "unbounded" })
      assertEquals(all, [[1, 2], [1, 2], [1, 2]])
    }))

  it.effect("toStream converts every source", () =>
    Effect.gen(function*() {
      assertEquals(yield* Stream.runCollect(toStream(new Set([1, 2]))), [1, 2])
    }))
})

describe("poll and waitFor", () => {
  it.effect("poll repeats until done", () =>
    Effect.gen(function*() {
      const counter = yield* Ref.make(0)
      const fiber = yield* Effect.forkChild(
        poll(Ref.updateAndGet(counter, (n) => n + 1), (n) => n >= 3, { interval: "1 second" }),
      )
      yield* TestClock.adjust("1 second")
      assertEquals(yield* Ref.get(counter), 2)
      yield* TestClock.adjust("1 second")
      assertEquals(yield* Fiber.join(fiber), 3)
      assertEquals(yield* pipe(Effect.succeed(5), poll((n: number) => n === 5)), 5)
    }))

  it.effect("waitFor resolves once the predicate holds", () =>
    Effect.gen(function*() {
      let ready = false
      const fiber = yield* Effect.forkChild(waitFor(() => ready, "1 second", { step: "100 millis" }))
      yield* TestClock.adjust("300 millis")
      ready = true
      yield* TestClock.adjust("100 millis")
      yield* Fiber.join(fiber)
    }))

  it.effect("waitFor fails with DeadlineError", () =>
    Effect.gen(function*() {
      const fiber = yield* Effect.forkChild(Effect.exit(waitFor(Effect.succeed(false), "1 second")))
      yield* TestClock.adjust("1 second")
      yield* assertFailsWithTag(yield* Fiber.join(fiber), "DeadlineError")
    }))
})

describe("lazy", () => {
  it.effect("computes once, on first use", () =>
    Effect.gen(function*() {
      const calls = yield* Ref.make(0)
      const value = yield* lazy(Ref.updateAndGet(calls, (n) => n + 1))
      assertFalse(yield* value.initialized)
      assertNone(yield* value.peek)
      assertEquals(yield* Ref.get(calls), 0)
      assertEquals(yield* value.get, 1)
      assertEquals(yield* value.get, 1)
      assert(yield* value.initialized)
      assertEquals(yield* value.peek, Option.some(1))
      yield* value.reset
      assertEquals(yield* value.get, 2)
    }))

  it.effect("shares one computation between concurrent uses", () =>
    Effect.gen(function*() {
      const calls = yield* Ref.make(0)
      const value = yield* lazy(Ref.updateAndGet(calls, (n) => n + 1).pipe(Effect.delay("1 second")))
      const fiber = yield* Effect.forkChild(Effect.all([value.get, value.get], { concurrency: "unbounded" }))
      yield* TestClock.adjust("1 second")
      assertEquals(yield* Fiber.join(fiber), [1, 1])
    }))

  it.effect("does not keep failures", () =>
    Effect.gen(function*() {
      const calls = yield* Ref.make(0)
      const value = yield* lazy(
        Ref.updateAndGet(calls, (n) => n + 1).pipe(
          Effect.flatMap((n) => n === 1 ? Effect.fail(new Boom({ n })) : Effect.succeed(n)),
        ),
      )
      yield* assertFailsWithTag(value.get, "Boom")
      assertEquals(yield* value.get, 2)
    }))
})

describe("allKeyed, allSettledKeyed, semaphore", () => {
  it.effect("allKeyed runs a record of effects", () =>
    Effect.gen(function*() {
      assertEquals(yield* allKeyed({ a: Effect.succeed(1), b: Effect.succeed("x") }), { a: 1, b: "x" })
      yield* assertFailsWithTag(allKeyed({ a: Effect.fail(new Boom({ n: 1 })) }), "Boom")
    }))

  it.effect("allSettledKeyed collects Results", () =>
    Effect.gen(function*() {
      const settled = yield* allSettledKeyed({ a: Effect.succeed(1), b: Effect.fail(new Boom({ n: 2 })) })
      assertEquals(settled.a, Result.succeed(1))
      assert(Result.isFailure(settled.b))
    }))

  it.effect("semaphore limits concurrency", () =>
    Effect.gen(function*() {
      const sem = yield* semaphore(1)
      const order = yield* Ref.make<Array<string>>([])
      const task = (name: string) =>
        Semaphore.withPermit(
          sem,
          Ref.update(order, (o) => [...o, `${name}+`]).pipe(
            Effect.andThen(Effect.sleep("1 second")),
            Effect.andThen(Ref.update(order, (o) => [...o, `${name}-`])),
          ),
        )
      const fiber = yield* Effect.forkChild(Effect.all([task("a"), task("b")], { concurrency: "unbounded" }))
      yield* TestClock.adjust("2 seconds")
      yield* Fiber.join(fiber)
      assertEquals(yield* Ref.get(order), ["a+", "a-", "b+", "b-"])
    }))
})
