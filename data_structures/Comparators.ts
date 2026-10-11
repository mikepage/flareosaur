// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * std's `ascend` and `descend` comparators, as Effect `Order`s.
 *
 * An Effect `Order<A>` is a function `(self: A, that: A) => -1 | 0 | 1`, so
 * std's comparators already are orders, for any type `<` and `>` can compare
 * (numbers, strings, bigints, Dates). Effect's own instances (`Order.Number`,
 * `Order.String`, `Order.Date`, `Order.mapInput`, `Order.flip`,
 * `Order.combine`) work wherever these do, and are the better choice when the
 * type is known.
 *
 * ```ts
 * import { Array } from "effect"
 * import { ascend, descend } from "@mikepage/flareosaur/data-structures/comparators"
 *
 * Array.sort([3, 1, 2], ascend) // [1, 2, 3]
 * Array.sort(["b", "a"], descend) // ["b", "a"]
 * ```
 *
 * @module
 */

import { Order } from "effect"
import { ascend as stdAscend, descend as stdDescend } from "./_std/comparators.ts"

/** Ascending order by `<` and `>`; usable as an `Order<A>` for any comparable `A`. */
export const ascend: <A>(self: A, that: A) => -1 | 0 | 1 = stdAscend

/** Descending order by `<` and `>`; `Order.flip` of {@linkcode ascend}. */
export const descend: <A>(self: A, that: A) => -1 | 0 | 1 = stdDescend

/** {@linkcode ascend} specialised to a type, for APIs that want an `Order.Order<A>` value. */
export const ascendOf = <A>(): Order.Order<A> => Order.make<A>(stdAscend)

/** {@linkcode descend} specialised to a type. */
export const descendOf = <A>(): Order.Order<A> => Order.make<A>(stdDescend)
