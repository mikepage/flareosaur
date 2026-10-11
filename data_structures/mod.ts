// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * Mutable data structures from `@std/data-structures`, with Effect
 * conventions: ordered structures take an Effect `Order`, lookups return an
 * `Option`, and every structure is pipeable and inspectable.
 *
 * Effect covers immutable collections (`HashMap`, `HashSet`, `Chunk`,
 * `MutableHashMap`, `MutableList`) and fiber-safe queues (`Queue`,
 * `TxPriorityQueue`). This package adds the classic mutable structures it
 * does not have: {@linkcode BinaryHeap}, {@linkcode IndexedHeap},
 * {@linkcode BinarySearchTree}, {@linkcode RedBlackTree},
 * {@linkcode Deque}, {@linkcode BidirectionalMap}, {@linkcode MultiMap},
 * {@linkcode RollingCounter} and {@linkcode D2Array}, plus std's
 * {@linkcode ascend} and {@linkcode descend} comparators as `Order`s.
 *
 * ```ts
 * import { Order } from "effect"
 * import { BinaryHeap, RedBlackTree } from "@mikepage/flareosaur/data-structures"
 *
 * const maxHeap = BinaryHeap.from([4, 1, 3], Order.flip(Order.Number))
 * maxHeap.pop() // Option.some(4)
 *
 * const tree = RedBlackTree.from([10, 20, 30], Order.Number)
 * tree.floor(25) // Option.some(20)
 * ```
 *
 * @module
 */

export * from "./BidirectionalMap.ts"
export * from "./BinaryHeap.ts"
export * from "./BinarySearchTree.ts"
export * from "./Comparators.ts"
export * from "./D2Array.ts"
export * from "./Deque.ts"
export * from "./IndexedHeap.ts"
export * from "./MultiMap.ts"
export * from "./RedBlackTree.ts"
export * from "./RollingCounter.ts"
