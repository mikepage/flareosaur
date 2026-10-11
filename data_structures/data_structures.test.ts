// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.
import { Array, Effect, Exit, Option, Order, pipe, Scope } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { describe, it } from "../testing/mod.ts"
import { assert, assertEquals, assertFalse, assertNone, assertThrows } from "../assert/mod.ts"
import {
  ascend,
  ascendOf,
  BidirectionalMap,
  BinaryHeap,
  BinarySearchTree,
  D2Array,
  Deque,
  descend,
  descendOf,
  IndexedHeap,
  MultiMap,
  RedBlackTree,
  RollingCounter,
} from "./mod.ts"

describe("comparators", () => {
  it("ascend and descend are Orders", () => {
    assertEquals(ascend(1, 2), -1)
    assertEquals(ascend("b", "a"), 1)
    assertEquals(descend(1, 2), 1)
    assertEquals(descend(2, 2), 0)
    assertEquals(Array.sort([3, 1, 2], ascend), [1, 2, 3])
    assertEquals(Array.sort([3n, 1n, 2n], descend), [3n, 2n, 1n])
    assertEquals(Array.sort([new Date(2), new Date(1)], ascendOf<Date>()), [new Date(1), new Date(2)])
    assertEquals(Array.sort(["a", "c", "b"], descendOf<string>()), ["c", "b", "a"])
  })
})

describe("BinaryHeap", () => {
  it("pops in order", () => {
    const heap = new BinaryHeap(Order.Number)
    assertEquals(heap.push(4, 1, 3, 5, 2), 5)
    assertEquals(heap.peek(), Option.some(1))
    assertEquals([heap.pop(), heap.pop()], [Option.some(1), Option.some(2)])
    assertEquals(heap.length, 3)
    heap.clear()
    assert(heap.isEmpty())
    assertNone(heap.pop())
    assertNone(heap.peek())
  })

  it("is a max heap with a flipped order", () => {
    const heap = BinaryHeap.from([4, 1, 3, 5, 2], Order.flip(Order.Number))
    assertEquals([...heap.drain()], [5, 4, 3, 2, 1])
    assert(heap.isEmpty())
  })

  it("orders objects by a mapped Order", () => {
    const byId = Order.mapInput(Order.Number, (x: { id: number }) => x.id)
    const heap = BinaryHeap.from([{ id: 3 }, { id: 1 }, { id: 2 }], byId)
    assertEquals(heap.pop(), Option.some({ id: 1 }))
  })

  it("iterates a sorted copy without emptying", () => {
    const heap = BinaryHeap.from([3, 1, 2], Order.Number)
    assertEquals([...heap], [1, 2, 3])
    assertEquals(heap.length, 3)
    assertEquals(heap.toArray().length, 3)
    assertEquals(heap.toJSON(), { _id: "BinaryHeap", values: [1, 2, 3] })
    assertEquals(heap.pipe((h) => h.length), 3)
  })

  it("holds undefined values", () => {
    const heap = BinaryHeap.from([undefined], () => 0)
    assertEquals(heap.pop(), Option.some(undefined))
  })
})

describe("BinarySearchTree and RedBlackTree", () => {
  for (const [name, make] of [
    ["BinarySearchTree", (xs: Iterable<number>) => BinarySearchTree.from(xs, Order.Number)],
    ["RedBlackTree", (xs: Iterable<number>) => RedBlackTree.from(xs, Order.Number)],
  ] as const) {
    it(`${name} inserts, finds and removes`, () => {
      const tree = make([])
      assertNone(tree.min())
      assertNone(tree.max())
      assert(tree.isEmpty())
      for (const n of [42, 43, 41, 40, 44]) assert(tree.insert(n))
      assertFalse(tree.insert(42))
      assertEquals(tree.size, 5)
      assertEquals(tree.find(41), Option.some(41))
      assertNone(tree.find(50))
      assertEquals(tree.min(), Option.some(40))
      assertEquals(tree.max(), Option.some(44))
      assert(tree.remove(42))
      assertFalse(tree.remove(42))
      assertEquals([...tree], [40, 41, 43, 44])
      assertEquals([...tree.rnlValues()], [44, 43, 41, 40])
      tree.clear()
      assertEquals(tree.size, 0)
    })

    it(`${name} answers ceiling, floor, higher and lower`, () => {
      const tree = make([10, 20, 30, 40, 50])
      assertEquals(tree.ceiling(25), Option.some(30))
      assertEquals(tree.ceiling(30), Option.some(30))
      assertNone(tree.ceiling(51))
      assertEquals(tree.floor(25), Option.some(20))
      assertEquals(tree.floor(20), Option.some(20))
      assertNone(tree.floor(5))
      assertEquals(tree.higher(30), Option.some(40))
      assertNone(tree.higher(50))
      assertEquals(tree.lower(30), Option.some(20))
      assertNone(tree.lower(10))
    })

    it(`${name} traverses in every order`, () => {
      const tree = make([2, 1, 3])
      assertEquals([...tree.lnrValues()], [1, 2, 3])
      assertEquals([...tree.nlrValues()].length, 3)
      assertEquals([...tree.lrnValues()].length, 3)
      assertEquals([...tree.lvlValues()].length, 3)
      assertEquals((tree.toJSON() as { values: Array<number> }).values, [1, 2, 3])
    })
  }

  it("RedBlackTree stays balanced", () => {
    const tree = RedBlackTree.from(Array.range(1, 1000), Order.Number)
    assertEquals(tree.size, 1000)
    // a degenerate tree would be 1000 levels deep; a red-black tree is at most 2 log2(n+1)
    let depth = 0
    let level = 0
    for (const _ of tree.lvlValues()) {
      level++
      if (level === 2 ** depth) {
        depth++
        level = 0
      }
    }
    assert(depth <= 20)
  })

  it("orders by a custom Order", () => {
    const tree = RedBlackTree.from(["bb", "a", "ccc"], Order.mapInput(Order.Number, (s: string) => s.length))
    assertEquals([...tree], ["a", "bb", "ccc"])
    assertEquals(tree.find("xx"), Option.some("bb"))
  })
})

describe("Deque", () => {
  it("pushes and pops at both ends", () => {
    const deque = new Deque([2, 3])
    assertEquals(deque.pushFront(0, 1), 4)
    assertEquals(deque.pushBack(4, 5), 6)
    assertEquals(deque.toArray(), [0, 1, 2, 3, 4, 5])
    assertEquals(deque.popFront(), Option.some(0))
    assertEquals(deque.popBack(), Option.some(5))
    assertEquals(deque.peekFront(), Option.some(1))
    assertEquals(deque.peekBack(), Option.some(4))
    assertEquals(deque.length, 4)
  })

  it("returns None when empty or out of range", () => {
    const deque = new Deque<number>()
    assert(deque.isEmpty())
    assertNone(deque.popFront())
    assertNone(deque.popBack())
    assertNone(deque.peekFront())
    assertNone(deque.peekBack())
    assertNone(deque.at(0))
    assertNone(deque.removeAt(0))
  })

  it("indexes, finds and removes", () => {
    const deque = Deque.from([10, 20, 30, 40])
    assertEquals(deque.at(1), Option.some(20))
    assertEquals(deque.at(-1), Option.some(40))
    assertNone(deque.at(4))
    assertEquals(deque.find((n) => n > 15), Option.some(20))
    assertEquals(deque.findIndex((n) => n > 25), Option.some(2))
    assertNone(deque.findIndex((n) => n > 99))
    assert(deque.includes(30))
    assertEquals(deque.removeFirst((n) => n === 20), Option.some(20))
    assertNone(deque.removeFirst((n) => n === 20))
    assertEquals(deque.removeAt(-1), Option.some(40))
    assertEquals([...deque], [10, 30])
    deque.retain((n) => n > 10)
    assertEquals([...deque.reversed()], [30])
    deque.clear()
    assertEquals(deque.length, 0)
  })

  it("grows past its initial capacity", () => {
    const deque = new Deque<number>()
    for (let i = 0; i < 100; i++) {
      deque.pushBack(i)
      deque.pushFront(-i)
    }
    assertEquals(deque.length, 200)
    assertEquals(deque.at(0), Option.some(-99))
    assertEquals(deque.at(-1), Option.some(99))
    assertEquals(deque.toJSON(), { _id: "Deque", values: deque.toArray() })
  })
})

describe("BidirectionalMap", () => {
  it("looks up both ways and keeps pairs unique", () => {
    const map = new BidirectionalMap([["one", 1], ["two", 2]])
    assertEquals(map.get("one"), Option.some(1))
    assertEquals(map.getReverse(2), Option.some("two"))
    assertNone(map.get("three"))
    assertNone(map.getReverse(3))
    map.set("uno", 1)
    assertFalse(map.has("one"))
    assert(map.hasReverse(1))
    assertEquals(map.getReverse(1), Option.some("uno"))
    map.set("two", 22)
    assertFalse(map.hasReverse(2))
    assertEquals(map.size, 2)
    assertEquals([...map], [["two", 22], ["uno", 1]])
    assertEquals([...map.keys()], ["two", "uno"])
    assertEquals([...map.values()], [22, 1])
  })

  it("deletes by key or value", () => {
    const map = new BidirectionalMap([["a", 1], ["b", 2]])
    assert(map.delete("a"))
    assertFalse(map.delete("a"))
    assertFalse(map.hasReverse(1))
    assert(map.deleteReverse(2))
    assertFalse(map.deleteReverse(2))
    assertEquals(map.size, 0)
    map.set("c", 3).clear()
    assertEquals([...map.entries()], [])
  })
})

describe("MultiMap", () => {
  it("groups values per key", () => {
    const map = new MultiMap<string, number>([["a", 1], ["b", 2]])
    map.add("a", 3).add("a", 1)
    assertEquals(map.get("a"), Option.some([1, 3, 1]))
    assertNone(map.get("c"))
    assertEquals(map.size, 2)
    assertEquals(map.valueCount, 4)
    assert(map.has("a"))
    assert(map.hasEntry("a", 3))
    assertFalse(map.hasEntry("b", 3))
    assertEquals([...map], [["a", 1], ["a", 3], ["a", 1], ["b", 2]])
    assertEquals([...map.groups()], [["a", [1, 3, 1]], ["b", [2]]])
    assertEquals([...map.keys()], ["a", "b"])
    assertEquals([...map.values()], [1, 3, 1, 2])
    assertEquals(map.toMap(), new Map([["a", [1, 3, 1]], ["b", [2]]]))
  })

  it("returns copies and deletes", () => {
    const map = new MultiMap<string, number>([["a", 1], ["a", 2]])
    Option.getOrThrow(map.get("a")).push(99)
    assertEquals(map.get("a"), Option.some([1, 2]))
    assert(map.deleteEntry("a", 1))
    assertFalse(map.deleteEntry("a", 1))
    assert(map.delete("a"))
    assertFalse(map.has("a"))
    map.add("x", 1).clear()
    assertEquals(map.size, 0)
  })

  it("groupBy", () => {
    const map = MultiMap.groupBy(["apple", "avocado", "banana"], (s) => s[0]!)
    assertEquals(map.get("a"), Option.some(["apple", "avocado"]))
    assertEquals(map.get("b"), Option.some(["banana"]))
    assertEquals(MultiMap.groupBy([1, 2, 3], (_, i) => i % 2).get(0), Option.some([1, 3]))
  })
})

describe("IndexedHeap", () => {
  it("pops by priority and updates priorities", () => {
    const heap = new IndexedHeap<string, number>(Order.Number, [["a", 5], ["b", 3], ["c", 4]])
    assertEquals(heap.size, 3)
    assertEquals(heap.peek(), Option.some({ key: "b", priority: 3 }))
    heap.set("a", 1)
    assertEquals(heap.peekKey(), Option.some("a"))
    assertEquals(heap.peekPriority(), Option.some(1))
    assertEquals(heap.pop(), Option.some({ key: "a", priority: 1 }))
    heap.set("c", 10)
    assertEquals(heap.pop(), Option.some({ key: "b", priority: 3 }))
    assertEquals(heap.pop(), Option.some({ key: "c", priority: 10 }))
    assertNone(heap.pop())
    assertNone(heap.peek())
    assert(heap.isEmpty())
  })

  it("push refuses a present key", () => {
    const heap = new IndexedHeap<string>(Order.Number)
    assert(heap.push("a", 1))
    assertFalse(heap.push("a", 2))
    assertEquals(heap.getPriority("a"), Option.some(1))
    assertNone(heap.getPriority("z"))
  })

  it("deletes, clears and iterates", () => {
    const heap = new IndexedHeap<string, string>(Order.flip(Order.String), [["x", "a"], ["y", "c"], ["z", "b"]])
    assertEquals(heap.peekKey(), Option.some("y"))
    assert(heap.delete("y"))
    assertFalse(heap.delete("y"))
    assertFalse(heap.has("y"))
    assertEquals(heap.toArray().length, 2)
    assertEquals([...heap].map((e) => e.key).sort(), ["x", "z"])
    heap.clear()
    assertEquals(heap.size, 0)
  })

  it("rejects NaN priorities", () => {
    const heap = new IndexedHeap<string>(Order.Number)
    assertThrows(() => heap.push("a", Number.NaN), RangeError)
  })
})

describe("RollingCounter", () => {
  it("counts over a sliding window", () => {
    const counter = new RollingCounter(3)
    assertEquals(counter.segmentCount, 3)
    assertEquals(counter.increment(), 1)
    assertEquals(counter.increment(2), 3)
    assertEquals(counter.current, 3)
    assertEquals(counter.rotate(), 0)
    counter.increment(5)
    assertEquals(counter.toArray(), [0, 3, 5])
    assertEquals(counter.rotate(), 0)
    assertEquals(counter.rotate(), 3)
    assertEquals(counter.total, 5)
    assertEquals([...counter], [5, 0, 0])
    assertEquals(counter.rotate(5), 5)
    assertEquals(counter.total, 0)
  })

  it("indexes segments", () => {
    const counter = new RollingCounter(3)
    counter.increment(1)
    counter.rotate()
    counter.increment(2)
    assertEquals(counter.at(-1), Option.some(2))
    assertEquals(counter.at(1), Option.some(1))
    assertNone(counter.at(3))
    counter.clear()
    assertEquals(counter.total, 0)
  })

  it("round-trips through a snapshot", () => {
    const counter = new RollingCounter(3)
    counter.increment(1)
    counter.rotate()
    counter.increment(2)
    const copy = RollingCounter.fromSnapshot(JSON.parse(JSON.stringify(counter)))
    assertEquals(copy.toArray(), [0, 1, 2])
    assertEquals(copy.total, 3)
    assertThrows(() => new RollingCounter(0), RangeError)
    assertThrows(() => counter.increment(-1), RangeError)
  })

  it.effect("rotates on a schedule with the Clock", () =>
    Effect.gen(function*() {
      const counter = new RollingCounter(3)
      const scope = yield* Scope.make()
      yield* counter.rotateEvery("1 second").pipe(Scope.provide(scope))
      counter.increment(4)
      yield* TestClock.adjust("1 second")
      counter.increment(1)
      assertEquals(counter.toArray(), [0, 4, 1])
      yield* TestClock.adjust("2 seconds")
      assertEquals(counter.toArray(), [1, 0, 0])
      yield* Scope.close(scope, Exit.succeed(undefined))
      yield* TestClock.adjust("10 seconds")
      assertEquals(counter.toArray(), [1, 0, 0])
    }))
})

describe("D2Array", () => {
  it("gets and sets cells", () => {
    const grid = new D2Array(3, 2, 0)
    assertEquals(grid.width, 3)
    assertEquals(grid.height, 2)
    assert(grid.set(1, 0, 5))
    assertFalse(grid.set(3, 0, 5))
    assertEquals(grid.get(1, 0), Option.some(5))
    assertNone(grid.get(3, 0))
    assertNone(grid.get(0, 2))
    assertEquals(grid.toArray(), [[0, 5, 0], [0, 0, 0]])
    assertEquals(grid.initialValue, 0)
  })

  it("slices, resizes and inserts", () => {
    const grid = new D2Array([[1, 2, 3], [4, 5, 6]], 0)
    assertEquals(grid.slice(1, 0, 2, 2).toArray(), [[2, 3], [5, 6]])
    grid.resize(4, 3)
    assertEquals(grid.toArray(), [[1, 2, 3, 0], [4, 5, 6, 0], [0, 0, 0, 0]])
    grid.insert(2, 1, [[7, 8], [9, 9], [9, 9]])
    assertEquals(grid.toArray(), [[1, 2, 3, 0], [4, 5, 7, 8], [0, 0, 9, 9]])
    grid.resize(2, 1)
    assertEquals([...grid], [[1, 2]])
    assertThrows(() => new D2Array(0, 1, 0))
  })

  it("copies its input", () => {
    const rows = [[1]]
    const grid = new D2Array(rows, 0)
    rows[0]![0] = 2
    assertEquals(grid.get(0, 0), Option.some(1))
    assertEquals(pipe(grid, (g) => g.width), 1)
  })
})
