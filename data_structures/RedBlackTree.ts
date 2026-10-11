// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * A self-balancing (red-black) binary search tree ordered by an Effect
 * `Order`, from `@std/data-structures`.
 *
 * Insert, remove and lookups are O(log n). Lookups (`find`, `min`, `max`,
 * `ceiling`, `floor`, `higher`, `lower`) return an `Option` instead of
 * `null`.
 *
 * ```ts
 * import { Order } from "effect"
 * import { RedBlackTree } from "@mikepage/flareosaur/data-structures/red-black-tree"
 *
 * const tree = RedBlackTree.from(["b", "c", "a"], Order.String)
 * tree.find("b") // Option.some("b")
 * tree.lower("b") // Option.some("a")
 * [...tree] // ["a", "b", "c"]
 * ```
 *
 * @module
 */

import type { Order } from "effect"
import { RedBlackTree as StdRedBlackTree } from "./_std/red_black_tree.ts"
import { SearchTree } from "./_tree.ts"

/** A red-black tree. */
export class RedBlackTree<A> extends SearchTree<A> {
  /** Creates an empty tree. */
  constructor(order: Order.Order<A>) {
    super(order, new StdRedBlackTree<A>(order))
  }

  /** Creates a tree holding `values`. */
  static from<A>(values: Iterable<A>, order: Order.Order<A>): RedBlackTree<A> {
    const tree = new RedBlackTree(order)
    for (const value of values) tree.insert(value)
    return tree
  }

  toJSON(): unknown {
    return { _id: "RedBlackTree", values: Array.from(this) }
  }
}
