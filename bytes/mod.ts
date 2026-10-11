// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * Helpers for `Uint8Array`s, from `@std/bytes`, with Effect conventions.
 *
 * Effect has no byte-array module, so the algorithms are std's. What changes
 * is the shape: searches return an `Option<number>` instead of `-1`,
 * {@linkcode Equivalence} plugs byte equality into Effect APIs that take an
 * `Equivalence`, and the two-argument helpers are dual, so they work both
 * data-first and in a `pipe`.
 *
 * ```ts
 * import { Option, pipe } from "effect"
 * import * as Bytes from "@mikepage/flareosaur/bytes"
 *
 * const source = new Uint8Array([0, 1, 2, 1, 2])
 * pipe(source, Bytes.indexOfNeedle(new Uint8Array([1, 2]))) // Option.some(1)
 * Bytes.lastIndexOfNeedle(source, new Uint8Array([1, 2])) // Option.some(3)
 * Bytes.indexOfNeedle(source, new Uint8Array([9])) // Option.none()
 * Bytes.concat([new Uint8Array([1]), new Uint8Array([2])]) // Uint8Array [1, 2]
 * ```
 *
 * @module
 */

import { Equivalence as Eq, Function, Option } from "effect"
import { concat as stdConcat } from "./_std/concat.ts"
import { copy as stdCopy } from "./_std/copy.ts"
import { endsWith as stdEndsWith } from "./_std/ends_with.ts"
import { equals as stdEquals } from "./_std/equals.ts"
import { indexOfNeedle as stdIndexOfNeedle } from "./_std/index_of_needle.ts"
import { lastIndexOfNeedle as stdLastIndexOfNeedle } from "./_std/last_index_of_needle.ts"
import { startsWith as stdStartsWith } from "./_std/starts_with.ts"

const isBytes = (u: unknown): u is Uint8Array => u instanceof Uint8Array

// Data-first when the first two arguments are both byte arrays.
const twoBytes = (args: IArguments): boolean => isBytes(args[0]) && isBytes(args[1])

const toOption = (index: number): Option.Option<number> => index === -1 ? Option.none() : Option.some(index)

/** Concatenates byte arrays into a new one. */
export const concat = (buffers: ReadonlyArray<Uint8Array>): Uint8Array<ArrayBuffer> => stdConcat(buffers)

/**
 * Copies `src` into `dst` at `offset` (default 0), truncating what does not
 * fit, and returns the number of bytes copied. Mutates `dst`.
 */
export const copy = (src: Uint8Array, dst: Uint8Array, offset?: number): number => stdCopy(src, dst, offset)

/** Whether `source` starts with `prefix`. */
export const startsWith: {
  (prefix: Uint8Array): (source: Uint8Array) => boolean
  (source: Uint8Array, prefix: Uint8Array): boolean
} = Function.dual(2, (source: Uint8Array, prefix: Uint8Array): boolean => stdStartsWith(source, prefix))

/** Whether `source` ends with `suffix`. */
export const endsWith: {
  (suffix: Uint8Array): (source: Uint8Array) => boolean
  (source: Uint8Array, suffix: Uint8Array): boolean
} = Function.dual(2, (source: Uint8Array, suffix: Uint8Array): boolean => stdEndsWith(source, suffix))

/** Whether two byte arrays hold the same bytes. */
export const equals: {
  (that: Uint8Array): (self: Uint8Array) => boolean
  (self: Uint8Array, that: Uint8Array): boolean
} = Function.dual(2, (self: Uint8Array, that: Uint8Array): boolean => stdEquals(self, that))

/** Byte equality as an `Equivalence`, for Effect APIs such as `Array.dedupeWith`. */
export const Equivalence: Eq.Equivalence<Uint8Array> = Eq.make((self, that) => stdEquals(self, that))

/**
 * The index of the first occurrence of `needle` in `source`, searching from
 * `start` (default 0; negative counts from the end).
 */
export const indexOfNeedle: {
  (needle: Uint8Array, start?: number): (source: Uint8Array) => Option.Option<number>
  (source: Uint8Array, needle: Uint8Array, start?: number): Option.Option<number>
} = Function.dual(
  twoBytes,
  (source: Uint8Array, needle: Uint8Array, start?: number): Option.Option<number> =>
    toOption(stdIndexOfNeedle(source, needle, start)),
)

/**
 * The index of the last occurrence of `needle` in `source`, searching
 * backwards from `start` (default: the last index).
 */
export const lastIndexOfNeedle: {
  (needle: Uint8Array, start?: number): (source: Uint8Array) => Option.Option<number>
  (source: Uint8Array, needle: Uint8Array, start?: number): Option.Option<number>
} = Function.dual(
  twoBytes,
  (source: Uint8Array, needle: Uint8Array, start?: number): Option.Option<number> =>
    toOption(stdLastIndexOfNeedle(source, needle, start)),
)

/** Whether `needle` occurs in `source`, searching from `start` (default 0). */
export const includesNeedle: {
  (needle: Uint8Array, start?: number): (source: Uint8Array) => boolean
  (source: Uint8Array, needle: Uint8Array, start?: number): boolean
} = Function.dual(
  twoBytes,
  (source: Uint8Array, needle: Uint8Array, start?: number): boolean => stdIndexOfNeedle(source, needle, start) !== -1,
)

/**
 * Repeats `source` `count` times into a new byte array. Like Effect's
 * `Array.replicate`, the count is normalized rather than rejected: it is
 * floored, and a negative count gives an empty array.
 */
export const repeat: {
  (count: number): (source: Uint8Array) => Uint8Array<ArrayBuffer>
  (source: Uint8Array, count: number): Uint8Array<ArrayBuffer>
} = Function.dual(2, (source: Uint8Array, count: number): Uint8Array<ArrayBuffer> => {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0
  const repeated = new Uint8Array(source.length * n)
  for (let offset = 0; offset < repeated.length; offset += source.length) repeated.set(source, offset)
  return repeated
})
