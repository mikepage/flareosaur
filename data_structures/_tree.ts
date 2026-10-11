// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.
// The shared API of BinarySearchTree and RedBlackTree, over std's trees.

import { Option, type Order } from "effect"
import type { BinarySearchNode } from "./_std/_binary_search_node.ts"
import { internals } from "./_std/_binary_search_tree_internals.ts"
import type { BinarySearchTree as StdBinarySearchTree } from "./_std/binary_search_tree.ts"
import { Structure } from "./_base.ts"

type Bound = "ceiling" | "floor" | "higher" | "lower"

// The value nearest to `value` in the direction of `bound`.
const findBound = <A>(
  root: BinarySearchNode<A> | null,
  value: A,
  order: Order.Order<A>,
  bound: Bound,
): Option.Option<A> => {
  let best: Option.Option<A> = Option.none()
  let node = root
  const up = bound === "ceiling" || bound === "higher"
  const inclusive = bound === "ceiling" || bound === "floor"
  while (node !== null) {
    const c = order(node.value, value)
    if (c === 0 && inclusive) return Option.some(node.value)
    if (up ? c > 0 : c < 0) {
      best = Option.some(node.value)
      node = up ? node.left : node.right
    } else {
      node = up ? node.right : node.left
    }
  }
  return best
}

/** A binary search tree ordered by an Effect `Order`. */
export abstract class SearchTree<A> extends Structure implements Iterable<A> {
  /** The order the tree keeps its values in. */
  readonly order: Order.Order<A>
  protected readonly tree: StdBinarySearchTree<A>

  protected constructor(order: Order.Order<A>, tree: StdBinarySearchTree<A>) {
    super()
    this.order = order
    this.tree = tree
  }

  /** The number of values. */
  get size(): number {
    return this.tree.size
  }

  /** Whether the tree is empty. */
  isEmpty(): boolean {
    return this.tree.isEmpty()
  }

  /** Adds `value`; returns `false` when an equal value (by the order) was already present. */
  insert(value: A): boolean {
    return this.tree.insert(value)
  }

  /** Removes the value equal to `value`; returns whether one was present. */
  remove(value: A): boolean {
    return this.tree.remove(value)
  }

  /** The stored value equal to `value` by the order. */
  find(value: A): Option.Option<A> {
    const node = internals.findNode(this.tree, value)
    return node === null ? Option.none() : Option.some(node.value)
  }

  /** The smallest value. */
  min(): Option.Option<A> {
    const root = internals.getRoot(this.tree)
    return root === null ? Option.none() : Option.some(root.findMinNode().value)
  }

  /** The largest value. */
  max(): Option.Option<A> {
    const root = internals.getRoot(this.tree)
    return root === null ? Option.none() : Option.some(root.findMaxNode().value)
  }

  /** The smallest value greater than or equal to `value`. */
  ceiling(value: A): Option.Option<A> {
    return findBound(internals.getRoot(this.tree), value, this.order, "ceiling")
  }

  /** The largest value less than or equal to `value`. */
  floor(value: A): Option.Option<A> {
    return findBound(internals.getRoot(this.tree), value, this.order, "floor")
  }

  /** The smallest value strictly greater than `value`. */
  higher(value: A): Option.Option<A> {
    return findBound(internals.getRoot(this.tree), value, this.order, "higher")
  }

  /** The largest value strictly less than `value`. */
  lower(value: A): Option.Option<A> {
    return findBound(internals.getRoot(this.tree), value, this.order, "lower")
  }

  /** Removes every value. */
  clear(): void {
    this.tree.clear()
  }

  /** The values in order (in-order traversal). */
  lnrValues(): IterableIterator<A> {
    return this.tree.lnrValues()
  }

  /** The values in reverse order. */
  rnlValues(): IterableIterator<A> {
    return this.tree.rnlValues()
  }

  /** The values in pre-order (node, left, right). */
  nlrValues(): IterableIterator<A> {
    return this.tree.nlrValues()
  }

  /** The values in post-order (left, right, node). */
  lrnValues(): IterableIterator<A> {
    return this.tree.lrnValues()
  }

  /** The values level by level (breadth first). */
  lvlValues(): IterableIterator<A> {
    return this.tree.lvlValues()
  }

  /** The values in order. */
  [Symbol.iterator](): IterableIterator<A> {
    return this.tree.lnrValues()
  }
}
