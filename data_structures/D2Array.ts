// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * A fixed-size two-dimensional array, from `@std/data-structures`, with
 * `Option` cell lookups.
 *
 * The grid never grows on its own: {@linkcode D2Array.resize} changes its
 * size, filling new cells with the initial value. Width and height are
 * always at least 1; asking for less throws.
 *
 * ```ts
 * import { D2Array } from "@mikepage/flareosaur/data-structures/d2-array"
 *
 * const grid = new D2Array(3, 2, 0) // 3 wide, 2 high, filled with 0
 * grid.set(1, 0, 5)
 * grid.get(1, 0) // Option.some(5)
 * grid.get(9, 9) // Option.none()
 * grid.toArray() // [[0, 5, 0], [0, 0, 0]]
 * ```
 *
 * @module
 */

import { Option } from "effect"
import { D2Array as StdD2Array } from "./_std/unstable_2d_array.ts"
import { Structure } from "./_base.ts"

/** A two-dimensional array of rows. */
export class D2Array<A> extends Structure implements Iterable<Array<A>> {
  readonly #grid: StdD2Array<A>

  /** Creates a `width` × `height` grid filled with `initialValue`. */
  constructor(width: number, height: number, initialValue: A)
  /** Creates a grid from rows (copied); `initialValue` fills cells added by `resize`. */
  constructor(rows: ReadonlyArray<ReadonlyArray<A>>, initialValue: A)
  constructor(widthOrRows: number | ReadonlyArray<ReadonlyArray<A>>, heightOrInitial: number | A, initialValue?: A) {
    super()
    this.#grid = typeof widthOrRows === "number"
      ? new StdD2Array<A>(widthOrRows, heightOrInitial as number, initialValue as A)
      : new StdD2Array<A>(widthOrRows.map((row) => row.slice()), heightOrInitial as A)
  }

  /** The value cells added by {@linkcode D2Array.resize} get. */
  get initialValue(): A {
    return this.#grid.initialValue
  }

  /** The number of columns. */
  get width(): number {
    return this.#grid.width
  }

  /** The number of rows. */
  get height(): number {
    return this.#grid.height
  }

  /** The value at column `x`, row `y`. */
  get(x: number, y: number): Option.Option<A> {
    const row = this.#grid.raw[y]
    return row !== undefined && Number.isInteger(x) && x >= 0 && x < row.length ? Option.some(row[x] as A) : Option.none()
  }

  /** Sets the value at column `x`, row `y`; returns `false` when the cell is outside the grid. */
  set(x: number, y: number, value: A): boolean {
    const row = this.#grid.raw[y]
    if (row === undefined || !Number.isInteger(x) || x < 0 || x >= row.length) return false
    row[x] = value
    return true
  }

  /** A new grid of the `width` × `height` area starting at column `x`, row `y` (clipped to this grid). */
  slice(x = 0, y = 0, width?: number, height?: number): D2Array<A> {
    return new D2Array(this.#grid.slice(x, y, width, height).raw, this.#grid.initialValue)
  }

  /** Resizes the grid, cutting cells or adding cells filled with the initial value. */
  resize(width: number, height: number): void {
    this.#grid.resize(width, height)
  }

  /** Copies `value` into this grid with its top-left corner at column `x`, row `y` (clipped to this grid). */
  insert(x: number, y: number, value: ReadonlyArray<ReadonlyArray<A>> | D2Array<A>): void {
    this.#grid.insert(x, y, value instanceof D2Array ? value.toArray() : value.map((row) => row.slice()))
  }

  /** A copy of the rows. */
  toArray(): Array<Array<A>> {
    return this.#grid.raw.map((row) => row.slice())
  }

  /** The rows. */
  *[Symbol.iterator](): IterableIterator<Array<A>> {
    yield* this.#grid.raw
  }

  toJSON(): unknown {
    return { _id: "D2Array", rows: this.toArray() }
  }
}
