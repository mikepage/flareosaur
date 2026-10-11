// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * An unbalanced binary search tree ordered by an Effect `Order`.
 *
 * Lookups (`find`, `min`, `max`, `ceiling`, `floor`, `higher`, `lower`)
 * return an `Option` instead of `null`. For a tree that stays balanced, use
 * `RedBlackTree`; for an immutable sorted set, Effect has none built in, so
 * these mutable trees fill the gap.
 *
 * ```ts
 * import { Order } from "effect"
 * import { BinarySearchTree } from "@mikepage/flareosaur/data-structures/binary-search-tree"
 *
 * const tree = BinarySearchTree.from([42, 43, 41], Order.Number)
 * tree.min() // Option.some(41)
 * tree.ceiling(41.5) // Option.some(42)
 * [...tree] // [41, 42, 43]
 * ```
 *
 * @module
 */

import type { Order } from "effect"
import { BinarySearchTree as StdBinarySearchTree } from "./_std/binary_search_tree.ts"
import { SearchTree } from "./_tree.ts"

/** An unbalanced binary search tree. */
export class BinarySearchTree<A> extends SearchTree<A> {
  /** Creates an empty tree. */
  constructor(order: Order.Order<A>) {
    super(order, new StdBinarySearchTree<A>(order))
  }

  /** Creates a tree holding `values`, inserted in iteration order. */
  static from<A>(values: Iterable<A>, order: Order.Order<A>): BinarySearchTree<A> {
    const tree = new BinarySearchTree(order)
    for (const value of values) tree.insert(value)
    return tree
  }

  toJSON(): unknown {
    return { _id: "BinarySearchTree", values: Array.from(this) }
  }
}
