// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.
import { Effect, Option, Order, pipe, Random, Result } from "effect"
import { describe, it } from "../testing/mod.ts"
import { assert, assertEquals, assertFalse, assertNone } from "../assert/mod.ts"
import * as c from "./mod.ts"

const people = [
  { name: "Kim", age: 22 },
  { name: "Anna", age: 31 },
  { name: "Tim", age: 58 },
]

describe("arrays", () => {
  it("chunk", () => {
    assertEquals(c.chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])
    assertEquals(pipe([1, 2, 3], c.chunk(3)), [[1, 2, 3]])
    assertEquals(c.chunk([], 2), [])
  })

  it("distinct and distinctBy", () => {
    assertEquals(c.distinct([3, 2, 5, 2, 5]), [3, 2, 5])
    assertEquals(c.distinct([{ a: 1 }, { a: 1 }]), [{ a: 1 }])
    assertEquals(c.distinctBy(["Anna", "Kim", "Arnold", "Kate"], (s) => s.charAt(0)), ["Anna", "Kim"])
    assertEquals(pipe([1, 2, 3, 4], c.distinctBy((n) => n % 2)), [1, 2])
  })

  it("dropWhile, takeWhile, dropLastWhile, takeLastWhile", () => {
    const xs = [1, 2, 3, 4, 5, 6]
    assertEquals(c.dropWhile(xs, (n) => n < 3), [3, 4, 5, 6])
    assertEquals(c.takeWhile(xs, (n) => n < 3), [1, 2])
    assertEquals(c.dropLastWhile(xs, (n) => n > 4), [1, 2, 3, 4])
    assertEquals(c.takeLastWhile(xs, (n) => n > 4), [5, 6])
    assertEquals(pipe(new Set(xs), c.takeLastWhile((n) => n > 5)), [6])
    assertEquals(pipe(xs, c.dropLastWhile((_, i) => i > 0)), [1])
    assertEquals(c.takeLastWhile([], () => true), [])
  })

  it("findSingle", () => {
    assertEquals(c.findSingle([1, 2, 3], (n) => n > 2), Option.some(3))
    assertNone(c.findSingle([1, 2, 3], (n) => n > 1))
    assertNone(c.findSingle([1, 2, 3], (n) => n > 5))
    assertEquals(c.findSingle([undefined], () => true), Option.some(undefined))
    assertEquals(pipe([4, 5], c.findSingle((_, i) => i === 1)), Option.some(5))
  })

  it("firstNotNullishOf and mapNotNullish", () => {
    const tables = [{ number: 11, order: null }, { number: 12, order: "Soup" }, { number: 13, order: "Salad" }]
    assertEquals(c.firstNotNullishOf(tables, (t) => t.order), Option.some("Soup"))
    assertNone(c.firstNotNullishOf([null, undefined], (x) => x))
    assertEquals(c.firstNotNullishOf([0, 1], (x) => x), Option.some(0))
    assertEquals(c.mapNotNullish(tables, (t) => t.order), ["Soup", "Salad"])
    assertEquals(pipe([1, 2, 3], c.mapNotNullish((n) => n === 2 ? null : n * 10)), [10, 30])
  })

  it("withoutAll, intersect, union", () => {
    assertEquals(c.withoutAll([2, 1, 2, 3], [1, 2]), [3])
    assertEquals(pipe([1, 2, 3], c.withoutAll([2])), [1, 3])
    assertEquals(c.intersect(["Kim", "Anna", "Jonathan"], ["Anna", "Kim"], ["Kim", "Tim"]), ["Kim"])
    assertEquals(c.intersect([1, 1, 2], [1, 2]), [1, 2])
    assertEquals(c.intersect(), [])
    assertEquals(c.union(["Kim", "Anna"], ["Anna", "Tim"], ["Jonathan"]), ["Kim", "Anna", "Tim", "Jonathan"])
    assertEquals(c.union(), [])
  })

  it("zip, unzip, interleave", () => {
    assertEquals(c.zip([1, 2, 3], ["a", "b"]), [[1, "a"], [2, "b"]])
    assertEquals(c.unzip([[1, "a"], [2, "b"]]), [[1, 2], ["a", "b"]])
    assertEquals(c.interleave([1, 2, 3], ["a", "b"], [true]), [1, "a", true, 2, "b", 3])
  })

  it("permutations", () => {
    assertEquals(c.permutations([]), [])
    assertEquals(c.permutations([true]), [[true]])
    assertEquals(c.permutations(["a", "b", "c"]).length, 6)
    assertEquals(c.permutations([1, 2]), [[1, 2], [2, 1]])
  })

  it("runningReduce", () => {
    assertEquals(c.runningReduce([1, 2, 3, 4, 5], 0, (sum, n) => sum + n), [1, 3, 6, 10, 15])
    assertEquals(pipe(["a", "b"], c.runningReduce("", (acc, s, i) => acc + s + i)), ["a0", "a0b1"])
    assertEquals(c.runningReduce([], 0, (a: number, b: number) => a + b), [])
  })

  it("slidingWindows", () => {
    const xs = [1, 2, 3, 4, 5]
    assertEquals(c.slidingWindows(xs, 3), [[1, 2, 3], [2, 3, 4], [3, 4, 5]])
    assertEquals(c.slidingWindows(xs, 3, { step: 2 }), [[1, 2, 3], [3, 4, 5]])
    assertEquals(c.slidingWindows(xs, 3, { step: 2, partial: true }), [[1, 2, 3], [3, 4, 5], [5]])
    assertEquals(c.slidingWindows(xs, 4, { partial: true }), [[1, 2, 3, 4], [2, 3, 4, 5], [3, 4, 5], [4, 5], [5]])
    assertEquals(c.slidingWindows(xs, 6), [])
    assertEquals(c.slidingWindows([], 3, { partial: true }), [])
    assertEquals(c.slidingWindows(xs, 0), [])
    assertEquals(pipe(xs, c.slidingWindows(5)), [[1, 2, 3, 4, 5]])
    assertEquals(pipe(xs, c.slidingWindows(2, { step: 3 })), [[1, 2], [4, 5]])
  })

  it("sumOf", () => {
    assertEquals(c.sumOf(people, (p) => p.age), 111)
    assertEquals(pipe(people, c.sumOf((_, i) => i)), 3)
    assertEquals(c.sumOf([], () => 1), 0)
  })

  it("maxBy and minBy", () => {
    assertEquals(c.maxBy(people, (p) => p.age), Option.some(people[2]))
    assertEquals(c.minBy(people, (p) => p.name), Option.some(people[1]))
    assertEquals(pipe([new Date(1), new Date(3), new Date(2)], c.maxBy((d) => d)), Option.some(new Date(3)))
    assertEquals(c.maxBy([1n, 5n, 3n], (n) => n), Option.some(5n))
    assertEquals(c.maxBy([{ v: 1, id: "a" }, { v: 1, id: "b" }], (x) => x.v), Option.some({ v: 1, id: "a" }))
    assertNone(c.minBy([], (n: number) => n))
  })

  it("maxOf and minOf", () => {
    assertEquals(c.maxOf(people, (p) => p.age), Option.some(58))
    assertEquals(pipe(people, c.minOf((p) => p.age)), Option.some(22))
    assertEquals(c.maxOf([1n, 3n], (n) => n), Option.some(3n))
    assert(Number.isNaN(Option.getOrThrow(c.maxOf([1, Number.NaN, 3], (n) => n))))
    assertNone(c.maxOf([], (n: number) => n))
  })

  it("maxWith and minWith take an Order", () => {
    assertEquals(c.maxWith(["Kim", "Anna", "Tim"], Order.String), Option.some("Tim"))
    const byLength = Order.mapInput(Order.Number, (s: string) => s.length)
    assertEquals(pipe(["Kim", "Anna", "Tim"], c.minWith(byLength)), Option.some("Kim"))
    assertNone(c.maxWith([], Order.Number))
  })

  it("sortBy", () => {
    assertEquals(c.sortBy(people, (p) => p.age, { order: "desc" }).map((p) => p.name), ["Tim", "Anna", "Kim"])
    assertEquals(pipe(people, c.sortBy((p) => p.name)).map((p) => p.name), ["Anna", "Kim", "Tim"])
    assertEquals(c.sortBy([3, Number.NaN, 1, 2], (n) => n), [1, 2, 3, Number.NaN])
    assertEquals(c.sortBy([new Date(2), new Date(1)], (d) => d), [new Date(1), new Date(2)])
    const input = [3, 1, 2]
    c.sortBy(input, (n) => n)
    assertEquals(input, [3, 1, 2])
  })

  it("joinToString", () => {
    assertEquals(c.joinToString(people, (p) => p.name), "Kim,Anna,Tim")
    assertEquals(
      c.joinToString(people, (p) => p.name, { separator: " and ", prefix: "<", suffix: ">", limit: 2, truncated: "others" }),
      "<Kim and Anna and others>",
    )
    assertEquals(pipe(["a", "b"], c.joinToString((s, i) => `${i}${s}`, { separator: "-" })), "0a-1b")
  })

  it("binarySearch returns the index or the insertion point", () => {
    assertEquals(c.binarySearch([0, 1, 2, 3, 4], 2, Order.Number), Result.succeed(2))
    assertEquals(c.binarySearch([0, 1, 3, 4], 2, Order.Number), Result.fail(2))
    assertEquals(c.binarySearch([], 2, Order.Number), Result.fail(0))
    assertEquals(c.binarySearch([1, 2], 5, Order.Number), Result.fail(2))
    assertEquals(pipe(["a", "c", "e"], c.binarySearch("e", Order.String)), Result.succeed(2))
  })

  it("cycle repeats forever, and stays empty for empty input", () => {
    const out: Array<number> = []
    for (const n of c.cycle([1, 2, 3])) {
      if (out.length === 7) break
      out.push(n)
    }
    assertEquals(out, [1, 2, 3, 1, 2, 3, 1])
    assertEquals([...c.cycle([])], [])
  })

  it.effect("sample picks with Random", () =>
    Effect.gen(function*() {
      const picked = yield* c.sample([1, 2, 3])
      assert(Option.isSome(picked) && [1, 2, 3].includes(picked.value))
      assertNone(yield* c.sample([]))
      const a = yield* c.sample(["a", "b", "c", "d"]).pipe(Random.withSeed(42))
      const b = yield* c.sample(["a", "b", "c", "d"]).pipe(Random.withSeed(42))
      assertEquals(a, b)
    }))
})

describe("records", () => {
  it("associateBy and associateWith", () => {
    assertEquals(c.associateBy(people, (p) => p.name), { Kim: people[0], Anna: people[1], Tim: people[2] })
    assertEquals(pipe(["a", "bb"], c.associateWith((k) => k.length)), { a: 1, bb: 2 })
  })

  it("aggregateGroups passes the accumulator as an Option", () => {
    const foodHistory = { Anna: ["Burger", "Soup", "Salad"], Kim: ["Pasta"] }
    const summaries = c.aggregateGroups(
      foodHistory,
      (current: string, key, acc: Option.Option<string>) =>
        Option.match(acc, { onNone: () => `${key}: ${current}`, onSome: (s) => `${s}, ${current}` }),
    )
    assertEquals(summaries, { Anna: "Anna: Burger, Soup, Salad", Kim: "Kim: Pasta" })
  })

  it("reduceGroups", () => {
    assertEquals(c.reduceGroups({ Anna: [5, 10], Kim: [] }, (sum: number, n: number) => sum + n, 0), { Anna: 15, Kim: 0 })
    assertEquals(pipe({ a: ["x", "y"] }, c.reduceGroups((acc: string, s: string) => acc + s, "")), { a: "xy" })
  })

  it("filterEntries, filterKeys, filterValues, partitionEntries", () => {
    const menu = { Salad: 11, Soup: 8, Pasta: 13 }
    assertEquals(c.filterEntries(menu, ([item, price]) => item !== "Pasta" && price < 10), { Soup: 8 })
    assertEquals(pipe(menu, c.filterKeys((k) => k.startsWith("S"))), { Salad: 11, Soup: 8 })
    assertEquals(c.filterValues(menu, (price) => price > 10), { Salad: 11, Pasta: 13 })
    assertEquals(c.partitionEntries(menu, ([, price]) => price < 12), [{ Salad: 11, Soup: 8 }, { Pasta: 13 }])
  })

  it("mapEntries, mapKeys, mapValues", () => {
    const usersById = { a2e: { name: "Kim", age: 22 }, dfe: { name: "Anna", age: 31 } }
    assertEquals(c.mapEntries(usersById, ([id, { name }]) => [name, id]), { Kim: "a2e", Anna: "dfe" })
    assertEquals(pipe({ a: 1, b: 2 }, c.mapKeys((k) => k.toUpperCase())), { A: 1, B: 2 })
    assertEquals(c.mapValues({ a: 1, b: 2 }, (v, k) => `${k}${v * 2}`), { a: "a2", b: "b4" })
  })

  it("includesValue", () => {
    assert(c.includesValue({ a: 1, b: Number.NaN }, Number.NaN))
    assertFalse(c.includesValue({ a: 1 }, 2))
    assert(pipe({ a: "x" }, c.includesValue("x")))
  })

  it("invert and invertBy", () => {
    assertEquals(c.invert({ a: "x", b: "y" }), { x: "a", y: "b" })
    assertEquals(c.invertBy({ Kim: "Kim", Anna: "anna", Ann: "ANNA" }, (v) => String(v).toLowerCase()), {
      kim: ["Kim"],
      anna: ["Anna", "Ann"],
    })
  })

  it("pick and omit", () => {
    const obj = { a: 5, b: 6, c: 7 }
    assertEquals(c.pick(obj, ["a", "c"]), { a: 5, c: 7 })
    assertEquals(c.omit(obj, ["a"]), { b: 6, c: 7 })
    assertEquals(pipe(obj, c.pick(["b"])), { b: 6 })
  })

  it("deepMerge", () => {
    assertEquals(c.deepMerge({ foo: { bar: true } }, { foo: { baz: true, quux: {} }, qux: true }), {
      foo: { bar: true, baz: true, quux: {} },
      qux: true,
    })
    assertEquals(c.deepMerge({ a: [1] }, { a: [2] }), { a: [1, 2] })
    assertEquals(c.deepMerge({ a: [1] }, { a: [2] }, { arrays: "replace" }), { a: [2] })
    assertEquals(c.deepMerge({ s: new Set([1]) }, { s: new Set([2]) }), { s: new Set([1, 2]) })
  })
})
