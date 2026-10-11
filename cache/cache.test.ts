// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.
import { Effect, Fiber, Option, Ref, Schema } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { describe, it } from "../testing/mod.ts"
import { assert, assertEquals, assertFailsWithTag, assertFalse, assertNone, assertThrows } from "../assert/mod.ts"
import { LruCache, memoize, TtlCache } from "./mod.ts"

class Boom extends Schema.TaggedError<Boom>()("Boom", { n: Schema.Number }) {}

describe("memoize", () => {
  it.effect("returns the cached result for repeated calls", () =>
    Effect.gen(function*() {
      const calls = yield* Ref.make(0)
      const double = yield* memoize((n: number) => Ref.update(calls, (c) => c + 1).pipe(Effect.as(n * 2)))
      assertEquals(yield* double(2), 4)
      assertEquals(yield* double(2), 4)
      assertEquals(yield* double(3), 6)
      assertEquals(yield* Ref.get(calls), 2)
    }))

  it.effect("memoizes nullary functions", () =>
    Effect.gen(function*() {
      const calls = yield* Ref.make(0)
      const once = yield* memoize(() => Ref.updateAndGet(calls, (c) => c + 1))
      assertEquals(yield* once(), 1)
      assertEquals(yield* once(), 1)
    }))

  it.effect("caches by every argument, comparing structurally", () =>
    Effect.gen(function*() {
      const calls = yield* Ref.make(0)
      const f = yield* memoize((a: number, b: { readonly x: number }) =>
        Ref.update(calls, (c) => c + 1).pipe(Effect.as(a + b.x))
      )
      assertEquals(yield* f(1, { x: 1 }), 2)
      assertEquals(yield* f(1, { x: 1 }), 2)
      assertEquals(yield* f(1, { x: 2 }), 3)
      assertEquals(yield* f(2, { x: 1 }), 3)
      assertEquals(yield* Ref.get(calls), 3)
    }))

  it.effect("shares one evaluation between concurrent calls", () =>
    Effect.gen(function*() {
      const calls = yield* Ref.make(0)
      const slow = yield* memoize((n: number) =>
        Ref.update(calls, (c) => c + 1).pipe(Effect.andThen(Effect.sleep("1 second")), Effect.as(n))
      )
      const fiber = yield* Effect.forkChild(Effect.all([slow(1), slow(1), slow(1)], { concurrency: "unbounded" }))
      yield* TestClock.adjust("1 second")
      assertEquals(yield* Fiber.join(fiber), [1, 1, 1])
      assertEquals(yield* Ref.get(calls), 1)
    }))

  it.effect("does not cache failures by default", () =>
    Effect.gen(function*() {
      const calls = yield* Ref.make(0)
      const f = yield* memoize((n: number) =>
        Ref.updateAndGet(calls, (c) => c + 1).pipe(Effect.flatMap((c) => c === 1 ? Effect.fail(new Boom({ n })) : Effect.succeed(n)))
      )
      yield* assertFailsWithTag(f(1), "Boom")
      assertEquals(yield* f(1), 1)
      assertEquals(yield* Ref.get(calls), 2)
    }))

  it.effect("caches failures that errorIsCacheable accepts", () =>
    Effect.gen(function*() {
      const calls = yield* Ref.make(0)
      const f = yield* memoize(
        (n: number) => Ref.update(calls, (c) => c + 1).pipe(Effect.andThen(Effect.fail(new Boom({ n })))),
        { errorIsCacheable: (e) => e.n === 1 },
      )
      yield* assertFailsWithTag(f(1), "Boom")
      yield* assertFailsWithTag(f(1), "Boom")
      yield* assertFailsWithTag(f(2), "Boom")
      yield* assertFailsWithTag(f(2), "Boom")
      assertEquals(yield* Ref.get(calls), 3)
    }))

  it.effect("evicts the least recently used past capacity", () =>
    Effect.gen(function*() {
      const calls = yield* Ref.make<Array<number>>([])
      const f = yield* memoize((n: number) => Ref.update(calls, (c) => [...c, n]).pipe(Effect.as(n)), { capacity: 2 })
      yield* f(1)
      yield* f(2)
      yield* f(1)
      yield* f(3) // evicts 2
      yield* f(1)
      yield* f(2)
      assertEquals(yield* Ref.get(calls), [1, 2, 3, 2])
    }))

  it.effect("expires results after timeToLive", () =>
    Effect.gen(function*() {
      const calls = yield* Ref.make(0)
      const f = yield* memoize(() => Ref.updateAndGet(calls, (c) => c + 1), { timeToLive: "1 minute" })
      assertEquals(yield* f(), 1)
      yield* TestClock.adjust("59 seconds")
      assertEquals(yield* f(), 1)
      yield* TestClock.adjust("1 second")
      assertEquals(yield* f(), 2)
    }))
})

describe("LruCache", () => {
  it("deletes the least recently used", () => {
    const cache = new LruCache<number, string>(3)
    cache.set(1, "!").set(2, "!").set(1, "updated").set(3, "!").set(4, "!")
    assertEquals(cache.size, 3)
    assertNone(cache.get(2))
    assertEquals(cache.get(1), Option.some("updated"))
    assertEquals([...cache.keys()], [3, 4, 1])
    assertEquals(cache.maxSize, 3)
  })

  it("validates maxSize", () => {
    assertThrows(() => new LruCache(0), RangeError)
    assertThrows(() => new LruCache(1.5), RangeError)
  })

  it("peek and has do not promote", () => {
    const cache = new LruCache<string, number>(2)
    cache.set("a", 1).set("b", 2)
    assert(cache.has("a"))
    assertEquals(cache.peek("a"), Option.some(1))
    cache.set("c", 3)
    assertFalse(cache.has("a"))
    assertNone(cache.peek("a"))
  })

  it("calls onEject with the reason", () => {
    const ejected: Array<[string, number, string]> = []
    const cache = new LruCache<string, number>(1, { onEject: (k, v, r) => ejected.push([k, v, r]) })
    cache.set("a", 1).set("b", 2)
    assert(cache.delete("b"))
    assertFalse(cache.delete("b"))
    cache.set("c", 3)
    cache.clear()
    assertEquals(ejected, [["a", 1, "evicted"], ["b", 2, "deleted"], ["c", 3, "cleared"]])
    assertEquals(cache.size, 0)
  })

  it("is iterable, pipeable and inspectable", () => {
    const cache = new LruCache<string, number>(2).set("a", 1).set("b", 2)
    assertEquals([...cache], [["a", 1], ["b", 2]])
    assertEquals([...cache.values()], [1, 2])
    assertEquals([...cache.entries()], [["a", 1], ["b", 2]])
    assertEquals(cache.pipe((c) => c.size), 2)
    assertEquals(cache.toJSON(), { _id: "LruCache", maxSize: 2, entries: [["a", 1], ["b", 2]] })
  })
})

describe("TtlCache", () => {
  it.effect("expires entries after the default time to live", () =>
    Effect.gen(function*() {
      const cache = new TtlCache<string, number>("10 seconds")
      yield* cache.set("a", 1)
      yield* TestClock.adjust("9 seconds")
      assertEquals(yield* cache.get("a"), Option.some(1))
      yield* TestClock.adjust("1 second")
      assertNone(yield* cache.get("a"))
      assertEquals(yield* cache.size, 0)
    }))

  it.effect("honours a per-entry time to live", () =>
    Effect.gen(function*() {
      const cache = new TtlCache<string, number>("10 seconds")
      yield* cache.set("short", 1, { timeToLive: "1 second" })
      yield* cache.set("long", 2)
      yield* TestClock.adjust("1 second")
      assertFalse(yield* cache.has("short"))
      assert(yield* cache.has("long"))
      assertEquals(yield* cache.entries(), [["long", 2]])
    }))

  it.effect("restarts the time to live when an entry is set again", () =>
    Effect.gen(function*() {
      const cache = new TtlCache<string, number>("10 seconds")
      yield* cache.set("a", 1)
      yield* TestClock.adjust("5 seconds")
      yield* cache.set("a", 2)
      yield* TestClock.adjust("5 seconds")
      assertEquals(yield* cache.get("a"), Option.some(2))
    }))

  it.effect("calls onEject on expiry, delete and clear", () =>
    Effect.gen(function*() {
      const ejected: Array<[string, number]> = []
      const cache = new TtlCache<string, number>("1 second", { onEject: (k, v) => ejected.push([k, v]) })
      yield* cache.set("a", 1)
      yield* cache.set("b", 2, { timeToLive: "1 minute" })
      yield* cache.set("c", 3, { timeToLive: "1 minute" })
      yield* TestClock.adjust("1 second")
      yield* cache.peek("x")
      assert(yield* cache.delete("b"))
      assertFalse(yield* cache.delete("b"))
      yield* cache.clear()
      assertEquals(ejected, [["a", 1], ["b", 2], ["c", 3]])
    }))

  it.effect("peek does not slide", () =>
    Effect.gen(function*() {
      const cache = new TtlCache<string, number>("10 seconds", { slidingExpiration: true })
      yield* cache.set("a", 1)
      yield* TestClock.adjust("6 seconds")
      assertEquals(yield* cache.peek("a"), Option.some(1))
      yield* TestClock.adjust("4 seconds")
      assertNone(yield* cache.peek("a"))
    }))

  it.effect("sliding expiration resets the time to live on get", () =>
    Effect.gen(function*() {
      const cache = new TtlCache<string, number>("10 seconds", { slidingExpiration: true })
      yield* cache.set("a", 1)
      yield* TestClock.adjust("6 seconds")
      assertEquals(yield* cache.get("a"), Option.some(1))
      yield* TestClock.adjust("6 seconds")
      assertEquals(yield* cache.get("a"), Option.some(1))
      yield* TestClock.adjust("10 seconds")
      assertNone(yield* cache.get("a"))
    }))

  it.effect("absolute expiration caps sliding expiration", () =>
    Effect.gen(function*() {
      const cache = new TtlCache<string, number>("10 seconds", { slidingExpiration: true })
      yield* cache.set("a", 1, { absoluteExpiration: "15 seconds" })
      yield* TestClock.adjust("8 seconds")
      assertEquals(yield* cache.get("a"), Option.some(1))
      yield* TestClock.adjust("7 seconds")
      assertNone(yield* cache.get("a"))
    }))

  it("is pipeable and inspectable", () => {
    const cache = new TtlCache<string, number>("1 second")
    assertEquals(cache.pipe((c) => c.timeToLive.toJSON()), cache.timeToLive.toJSON())
    assertEquals((cache.toJSON() as { _id: string })._id, "TtlCache")
  })
})
