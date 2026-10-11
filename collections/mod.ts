// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * Collection helpers from `@std/collections`, in Effect's style.
 *
 * Every function keeps std's name. Where Effect's `Array`, `Record`,
 * `Struct` or `Iterable` modules already do the job, the function delegates
 * to them; the rest are std's algorithms reshaped for Effect: missing values
 * are `Option`s instead of `undefined`, comparisons take an `Order`, and the
 * functions are dual, so `collections.sumOf(xs, f)` and
 * `pipe(xs, collections.sumOf(f))` both work. Variadic functions
 * ({@linkcode intersect}, {@linkcode union}, {@linkcode zip},
 * {@linkcode interleave}) and {@linkcode deepMerge} are data-first only.
 *
 * | std                  | here, built on                                   |
 * | -------------------- | ------------------------------------------------ |
 * | `associateBy`        | `Record.fromIterableBy`                          |
 * | `associateWith`      | `Record.fromIterableWith`                        |
 * | `chunk`              | `Array.chunksOf`                                 |
 * | `distinct`           | `Array.dedupe` (compares with `Equal`)           |
 * | `dropWhile`          | `Array.dropWhile`                                |
 * | `takeWhile`          | `Array.takeWhile`                                |
 * | `filterValues`       | `Record.filter`                                  |
 * | `mapKeys`            | `Record.mapKeys`                                 |
 * | `mapValues`          | `Record.map`                                     |
 * | `mapNotNullish`      | `Array.filterMap` + `Option.fromNullishOr`       |
 * | `maxWith`, `minWith` | `Array.max`, `Array.min` with an `Order`         |
 * | `pick`, `omit`       | `Struct.pick`, `Struct.omit`                     |
 * | `runningReduce`      | `Array.scan`                                     |
 * | `sample`             | `Random.choice` (an Effect, so tests can seed it) |
 * | `unzip`              | `Array.unzip`                                    |
 * | `withoutAll`         | `Array.difference` (compares with `Equal`)       |
 * | `intersect`, `union` | `Array.intersection`, `Array.union` (`Equal`)    |
 * | `partition`          | use `Array.partition` (returns `[rest, matches]`) |
 *
 * Effect's `Equal` compares arrays and plain objects structurally, so the
 * functions marked `Equal` treat `{ a: 1 }` and `{ a: 1 }` as the same value,
 * where std compares by reference.
 *
 * ```ts
 * import { Effect, Option, Order, pipe } from "effect"
 * import * as collections from "@mikepage/flareosaur/collections"
 *
 * const people = [{ name: "Anna", age: 34 }, { name: "Kim", age: 42 }]
 *
 * collections.maxBy(people, (p) => p.age) // Option.some({ name: "Kim", age: 42 })
 * pipe(people, collections.sumOf((p) => p.age)) // 76
 * collections.findSingle(people, (p) => p.age > 40) // Option.some({ name: "Kim", age: 42 })
 * collections.slidingWindows([1, 2, 3, 4], 2) // [[1, 2], [2, 3], [3, 4]]
 * collections.binarySearch([1, 3, 5], 4, Order.Number) // Result.fail(2): insert at 2
 * const pick = collections.sample(people) // Effect<Option<{ name: string; age: number }>>
 * ```
 *
 * @module
 */

import {
  Array as Arr,
  Effect,
  Function,
  Option,
  Order,
  Predicate,
  Random,
  Record,
  Result,
  Struct,
} from "effect"
import { deepMerge as stdDeepMerge } from "./_std/deep_merge.ts"
import { distinctBy as stdDistinctBy } from "./_std/distinct_by.ts"
import { dropLastWhile as stdDropLastWhile } from "./_std/drop_last_while.ts"
import { filterEntries as stdFilterEntries } from "./_std/filter_entries.ts"
import { filterKeys as stdFilterKeys } from "./_std/filter_keys.ts"
import { includesValue as stdIncludesValue } from "./_std/includes_value.ts"
import { interleave as stdInterleave } from "./_std/interleave.ts"
import { invert as stdInvert, type InvertResult } from "./_std/invert.ts"
import { invertBy as stdInvertBy } from "./_std/invert_by.ts"
import { joinToString as stdJoinToString, type JoinToStringOptions } from "./_std/join_to_string.ts"
import { mapEntries as stdMapEntries } from "./_std/map_entries.ts"
import { partitionEntries as stdPartitionEntries } from "./_std/partition_entries.ts"
import { permutations as stdPermutations } from "./_std/permutations.ts"
import { takeLastWhile as stdTakeLastWhile } from "./_std/take_last_while.ts"
import { zip as stdZip } from "./_std/zip.ts"

export type { DeepMerge, DeepMergeOptions, MergingStrategy } from "./_std/deep_merge.ts"
export type { InvertResult, JoinToStringOptions }

/** The values std's `maxBy`, `minBy` and `sortBy` can compare with `<` and `>`. */
export type Comparable = number | string | bigint | Date

const isDataFirst = (args: IArguments): boolean => Predicate.isIterable(args[0])

// Compares with < and >, like std. NaN compares equal to everything.
const compareComparable = (a: Comparable, b: Comparable): -1 | 0 | 1 => a < b ? -1 : a > b ? 1 : 0

// ---------------------------------------------------------------------------
// Arrays and iterables
// ---------------------------------------------------------------------------

/** Splits an iterable into chunks of `size` elements; the last may be shorter. `Array.chunksOf`. */
export const chunk: {
  (size: number): <A>(self: Iterable<A>) => Array<Arr.NonEmptyArray<A>>
  <A>(self: Iterable<A>, size: number): Array<Arr.NonEmptyArray<A>>
} = Function.dual(2, <A>(self: Iterable<A>, size: number): Array<Arr.NonEmptyArray<A>> => Arr.chunksOf(self, size))

/** The distinct elements, compared with `Equal`, in first-seen order. `Array.dedupe`. */
export const distinct = <A>(self: Iterable<A>): Array<A> => Arr.dedupe(self)

/** The elements whose `discriminator` result (compared with SameValueZero) was not seen before. */
export const distinctBy: {
  <A, D>(discriminator: (a: A, index: number) => D): (self: Iterable<A>) => Array<A>
  <A, D>(self: Iterable<A>, discriminator: (a: A, index: number) => D): Array<A>
} = Function.dual(2, <A, D>(self: Iterable<A>, discriminator: (a: A, index: number) => D): Array<A> =>
  stdDistinctBy(self, discriminator))

/** Drops leading elements while `predicate` holds. `Array.dropWhile`. */
export const dropWhile: {
  <A>(predicate: (a: A, index: number) => boolean): (self: Iterable<A>) => Array<A>
  <A>(self: Iterable<A>, predicate: (a: A, index: number) => boolean): Array<A>
} = Function.dual(2, <A>(self: Iterable<A>, predicate: (a: A, index: number) => boolean): Array<A> =>
  Arr.dropWhile(self, predicate))

/** Takes leading elements while `predicate` holds. `Array.takeWhile`. */
export const takeWhile: {
  <A>(predicate: (a: A, index: number) => boolean): (self: Iterable<A>) => Array<A>
  <A>(self: Iterable<A>, predicate: (a: A, index: number) => boolean): Array<A>
} = Function.dual(2, <A>(self: Iterable<A>, predicate: (a: A, index: number) => boolean): Array<A> =>
  Arr.takeWhile(self, predicate))

/** Drops trailing elements while `predicate` holds. */
export const dropLastWhile: {
  <A>(predicate: (a: A, index: number) => boolean): (self: Iterable<A>) => Array<A>
  <A>(self: Iterable<A>, predicate: (a: A, index: number) => boolean): Array<A>
} = Function.dual(2, <A>(self: Iterable<A>, predicate: (a: A, index: number) => boolean): Array<A> =>
  stdDropLastWhile(Arr.fromIterable(self), predicate))

/** Takes trailing elements while `predicate` holds. */
export const takeLastWhile: {
  <A>(predicate: (a: A, index: number) => boolean): (self: Iterable<A>) => Array<A>
  <A>(self: Iterable<A>, predicate: (a: A, index: number) => boolean): Array<A>
} = Function.dual(2, <A>(self: Iterable<A>, predicate: (a: A, index: number) => boolean): Array<A> =>
  stdTakeLastWhile(Arr.fromIterable(self), predicate))

/** The only element matching `predicate`; `None` when no element or more than one matches. */
export const findSingle: {
  <A>(predicate: (a: A, index: number) => boolean): (self: Iterable<A>) => Option.Option<A>
  <A>(self: Iterable<A>, predicate: (a: A, index: number) => boolean): Option.Option<A>
} = Function.dual(2, <A>(self: Iterable<A>, predicate: (a: A, index: number) => boolean): Option.Option<A> => {
  let match: Option.Option<A> = Option.none()
  let index = 0
  for (const a of self) {
    if (predicate(a, index++)) {
      if (Option.isSome(match)) return Option.none()
      match = Option.some(a)
    }
  }
  return match
})

/** The first result of `selector` that is neither `null` nor `undefined`. */
export const firstNotNullishOf: {
  <A, B>(selector: (a: A, index: number) => B | null | undefined): (self: Iterable<A>) => Option.Option<NonNullable<B>>
  <A, B>(self: Iterable<A>, selector: (a: A, index: number) => B | null | undefined): Option.Option<NonNullable<B>>
} = Function.dual(
  2,
  <A, B>(self: Iterable<A>, selector: (a: A, index: number) => B | null | undefined): Option.Option<NonNullable<B>> =>
    Arr.findFirst(self, (a, i) => Option.fromNullishOr(selector(a, i))),
)

/** Maps every element and keeps the results that are neither `null` nor `undefined`. */
export const mapNotNullish: {
  <A, B>(f: (a: A, index: number) => B): (self: Iterable<A>) => Array<NonNullable<B>>
  <A, B>(self: Iterable<A>, f: (a: A, index: number) => B): Array<NonNullable<B>>
} = Function.dual(2, <A, B>(self: Iterable<A>, f: (a: A, index: number) => B): Array<NonNullable<B>> =>
  Arr.filterMap(self, (a, i) => {
    const b = f(a, i)
    return b === null || b === undefined ? Result.failVoid : Result.succeed(b as NonNullable<B>)
  }))

/** The elements of `self` that are not in `values` (compared with `Equal`). `Array.difference`. */
export const withoutAll: {
  <A>(values: Iterable<A>): (self: Iterable<A>) => Array<A>
  <A>(self: Iterable<A>, values: Iterable<A>): Array<A>
} = Function.dual(2, <A>(self: Iterable<A>, values: Iterable<A>): Array<A> => Arr.difference(self, values))

/** The distinct elements present in every iterable (compared with `Equal`), in the order of the first. */
export const intersect = <A>(...iterables: ReadonlyArray<Iterable<A>>): Array<A> => {
  if (iterables.length === 0) return []
  const [first, ...rest] = iterables
  return rest.reduce<Array<A>>((acc, it) => Arr.intersection(acc, it), Arr.dedupe(first!))
}

/** The distinct elements of all iterables (compared with `Equal`), in first-seen order. */
export const union = <A>(...iterables: ReadonlyArray<Iterable<A>>): Array<A> =>
  iterables.reduce<Array<A>>((acc, it) => Arr.union(acc, it), [])

/** Zips iterables into tuples, as long as the shortest one. */
export const zip = <T extends Array<unknown>>(...iterables: { [K in keyof T]: Iterable<T[K]> }): Array<T> =>
  stdZip<T>(...iterables)

/** Splits pairs into two arrays. `Array.unzip`. */
export const unzip = <A, B>(pairs: Iterable<readonly [A, B]>): [Array<A>, Array<B>] => Arr.unzip(pairs)

/** Takes one element of each iterable in turn, skipping iterables that ran out. */
export const interleave = <T extends Array<unknown>>(...iterables: { [K in keyof T]: Iterable<T[K]> }): Array<T[number]> =>
  stdInterleave<T>(...iterables)

/** Every ordering of the elements (Heap's algorithm). */
export const permutations = <A>(self: Iterable<A>): Array<Array<A>> => stdPermutations(self)

/**
 * The running results of a reduction, without the initial value: `[1, 2, 3]`
 * summed from 0 gives `[1, 3, 6]`. `Array.scan` minus its first element.
 */
export const runningReduce: {
  <A, B>(initial: B, f: (acc: B, a: A, index: number) => B): (self: Iterable<A>) => Array<B>
  <A, B>(self: Iterable<A>, initial: B, f: (acc: B, a: A, index: number) => B): Array<B>
} = Function.dual(3, <A, B>(self: Iterable<A>, initial: B, f: (acc: B, a: A, index: number) => B): Array<B> => {
  let index = 0
  return Arr.scan(self, initial, (acc, a) => f(acc, a, index++)).slice(1)
})

/** Options for {@linkcode slidingWindows}. */
export interface SlidingWindowsOptions {
  /** How far each window moves. Defaults to 1. */
  readonly step?: number | undefined
  /** Keep the shorter windows at the end. Defaults to `false`. */
  readonly partial?: boolean | undefined
}

/**
 * Windows of `size` consecutive elements, `step` apart. Like `Array.window`
 * (which is the case `step: 1`), a size or step below 1 gives no windows.
 */
export const slidingWindows: {
  (size: number, options?: SlidingWindowsOptions): <A>(self: Iterable<A>) => Array<Array<A>>
  <A>(self: Iterable<A>, size: number, options?: SlidingWindowsOptions): Array<Array<A>>
} = Function.dual(isDataFirst, <A>(self: Iterable<A>, size: number, options?: SlidingWindowsOptions): Array<Array<A>> => {
  const n = Math.floor(size)
  const step = Math.floor(options?.step ?? 1)
  if (!(n >= 1) || !(step >= 1)) return []
  const array = Arr.fromIterable(self)
  const windows: Array<Array<A>> = []
  for (let i = 0; i < array.length; i += step) {
    const window = array.slice(i, i + n)
    if (window.length === n || (options?.partial && window.length > 0)) windows.push(window)
  }
  return windows
})

/** Sums `selector` over the elements. */
export const sumOf: {
  <A>(selector: (a: A, index: number) => number): (self: Iterable<A>) => number
  <A>(self: Iterable<A>, selector: (a: A, index: number) => number): number
} = Function.dual(2, <A>(self: Iterable<A>, selector: (a: A, index: number) => number): number => {
  let sum = 0
  let index = 0
  for (const a of self) sum += selector(a, index++)
  return sum
})

const extremeBy = <A>(self: Iterable<A>, selector: (a: A, index: number) => Comparable, sign: 1 | -1): Option.Option<A> => {
  let best: Option.Option<[A, Comparable]> = Option.none()
  let index = 0
  for (const a of self) {
    const value = selector(a, index++)
    if (Option.isNone(best) || compareComparable(value, best.value[1]) === sign) best = Option.some([a, value])
  }
  return Option.map(best, ([a]) => a)
}

/** The element with the largest `selector` value (the first one on ties). */
export const maxBy: {
  <A>(selector: (a: A, index: number) => Comparable): (self: Iterable<A>) => Option.Option<A>
  <A>(self: Iterable<A>, selector: (a: A, index: number) => Comparable): Option.Option<A>
} = Function.dual(2, <A>(self: Iterable<A>, selector: (a: A, index: number) => Comparable): Option.Option<A> =>
  extremeBy(self, selector, 1))

/** The element with the smallest `selector` value (the first one on ties). */
export const minBy: {
  <A>(selector: (a: A, index: number) => Comparable): (self: Iterable<A>) => Option.Option<A>
  <A>(self: Iterable<A>, selector: (a: A, index: number) => Comparable): Option.Option<A>
} = Function.dual(2, <A>(self: Iterable<A>, selector: (a: A, index: number) => Comparable): Option.Option<A> =>
  extremeBy(self, selector, -1))

const extremeOf = <A, N extends number | bigint>(
  self: Iterable<A>,
  selector: (a: A, index: number) => N,
  sign: 1 | -1,
): Option.Option<N> => {
  let best: Option.Option<N> = Option.none()
  let index = 0
  for (const a of self) {
    const value = selector(a, index++)
    if (typeof value === "number" && Number.isNaN(value)) return Option.some(value)
    if (Option.isNone(best) || (sign === 1 ? value > best.value : value < best.value)) best = Option.some(value)
  }
  return best
}

/** The largest `selector` value; `NaN` if any value is `NaN`. */
export const maxOf: {
  <A, N extends number | bigint>(selector: (a: A, index: number) => N): (self: Iterable<A>) => Option.Option<N>
  <A, N extends number | bigint>(self: Iterable<A>, selector: (a: A, index: number) => N): Option.Option<N>
} = Function.dual(2, <A, N extends number | bigint>(self: Iterable<A>, selector: (a: A, index: number) => N) =>
  extremeOf(self, selector, 1))

/** The smallest `selector` value; `NaN` if any value is `NaN`. */
export const minOf: {
  <A, N extends number | bigint>(selector: (a: A, index: number) => N): (self: Iterable<A>) => Option.Option<N>
  <A, N extends number | bigint>(self: Iterable<A>, selector: (a: A, index: number) => N): Option.Option<N>
} = Function.dual(2, <A, N extends number | bigint>(self: Iterable<A>, selector: (a: A, index: number) => N) =>
  extremeOf(self, selector, -1))

/** The largest element by `order`. `Array.max` that also accepts empty input. */
export const maxWith: {
  <A>(order: Order.Order<A>): (self: Iterable<A>) => Option.Option<A>
  <A>(self: Iterable<A>, order: Order.Order<A>): Option.Option<A>
} = Function.dual(2, <A>(self: Iterable<A>, order: Order.Order<A>): Option.Option<A> => {
  const array = Arr.fromIterable(self)
  return Arr.isReadonlyArrayNonEmpty(array) ? Option.some(Arr.max(array, order)) : Option.none()
})

/** The smallest element by `order`. `Array.min` that also accepts empty input. */
export const minWith: {
  <A>(order: Order.Order<A>): (self: Iterable<A>) => Option.Option<A>
  <A>(self: Iterable<A>, order: Order.Order<A>): Option.Option<A>
} = Function.dual(2, <A>(self: Iterable<A>, order: Order.Order<A>): Option.Option<A> => {
  const array = Arr.fromIterable(self)
  return Arr.isReadonlyArrayNonEmpty(array) ? Option.some(Arr.min(array, order)) : Option.none()
})

/** Options for {@linkcode sortBy}. */
export interface SortByOptions {
  /** Ascending (the default) or descending. */
  readonly order?: "asc" | "desc" | undefined
}

/**
 * Sorts by the value `selector` returns (a number, string, bigint or `Date`),
 * stably, with `NaN` last. Does not mutate the input. To sort by an `Order`,
 * use `Array.sortWith(self, selector, order)` or `Array.sort`.
 */
export const sortBy: {
  <A>(selector: (a: A, index: number) => Comparable, options?: SortByOptions): (self: Iterable<A>) => Array<A>
  <A>(self: Iterable<A>, selector: (a: A, index: number) => Comparable, options?: SortByOptions): Array<A>
} = Function.dual(
  isDataFirst,
  <A>(self: Iterable<A>, selector: (a: A, index: number) => Comparable, options?: SortByOptions): Array<A> => {
    const sign = options?.order === "desc" ? -1 : 1
    const keyed = Arr.map(Arr.fromIterable(self), (a, i) => [a, selector(a, i)] as const)
    keyed.sort(([, a], [, b]) => {
      if (Number.isNaN(a)) return Number.isNaN(b) ? 0 : 1
      if (Number.isNaN(b)) return -1
      return sign * compareComparable(a, b)
    })
    return keyed.map(([a]) => a)
  },
)

/**
 * Joins the `selector` results with `separator` (default `","`), between
 * `prefix` and `suffix`, stopping after `limit` elements with `truncated`
 * (default `"..."`).
 */
export const joinToString: {
  <A>(selector: (a: A, index: number) => string, options?: JoinToStringOptions): (self: Iterable<A>) => string
  <A>(self: Iterable<A>, selector: (a: A, index: number) => string, options?: JoinToStringOptions): string
} = Function.dual(
  isDataFirst,
  <A>(self: Iterable<A>, selector: (a: A, index: number) => string, options?: JoinToStringOptions): string =>
    stdJoinToString(self, selector, options),
)

/**
 * Searches a sorted array for `needle` with `order`. Succeeds with the index
 * of a match, or fails with the index where `needle` would be inserted to keep
 * the array sorted (std returns `-(insertion point) - 1` instead).
 */
export const binarySearch: {
  <A>(needle: NoInfer<A>, order: Order.Order<A>): (self: ArrayLike<A>) => Result.Result<number, number>
  <A>(self: ArrayLike<A>, needle: NoInfer<A>, order: Order.Order<A>): Result.Result<number, number>
} = Function.dual(3, <A>(self: ArrayLike<A>, needle: A, order: Order.Order<A>): Result.Result<number, number> => {
  let start = 0
  let end = self.length - 1
  while (start <= end) {
    const mid = (start + end) >>> 1
    const c = order(self[mid]!, needle)
    if (c === 0) return Result.succeed(mid)
    if (c < 0) start = mid + 1
    else end = mid - 1
  }
  return Result.fail(start)
})

/**
 * Repeats the elements forever. Unlike `Iterable.forever` (and std's
 * `cycle`), an empty input gives an empty iterable instead of looping.
 */
export const cycle = <A>(self: Iterable<A>): Iterable<A> => ({
  *[Symbol.iterator]() {
    const array = Arr.fromIterable(self)
    if (array.length === 0) return
    while (true) yield* array
  },
})

/** A random element, or `None` for empty input. Uses Effect's `Random`, so tests can seed it with `Random.withSeed`. */
export const sample = <A>(self: Iterable<A>): Effect.Effect<Option.Option<A>> => {
  const array = Arr.fromIterable(self)
  return Arr.isReadonlyArrayNonEmpty(array) ? Effect.asSome(Random.choice(array)) : Effect.succeedNone
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

/** A record of the elements keyed by `selector`; later elements win. `Record.fromIterableBy`. */
export const associateBy: {
  <A>(selector: (a: A) => string): (self: Iterable<A>) => Record<string, A>
  <A>(self: Iterable<A>, selector: (a: A) => string): Record<string, A>
} = Function.dual(2, <A>(self: Iterable<A>, selector: (a: A) => string): Record<string, A> =>
  Record.fromIterableBy(self, selector))

/** A record from keys to `selector(key)`. `Record.fromIterableWith`. */
export const associateWith: {
  <B>(selector: (key: string) => B): (self: Iterable<string>) => Record<string, B>
  <B>(self: Iterable<string>, selector: (key: string) => B): Record<string, B>
} = Function.dual(2, <B>(self: Iterable<string>, selector: (key: string) => B): Record<string, B> =>
  Record.fromIterableWith(self, (key) => [key, selector(key)] as const))

/**
 * Aggregates every group of a record of arrays. The aggregator receives the
 * accumulator as an `Option`: `None` for the first element of a group (std
 * passes a `first` flag and `undefined` instead).
 */
export const aggregateGroups: {
  <A, B>(aggregator: (current: A, key: string, accumulator: Option.Option<B>) => B): (
    self: Readonly<Record<string, ReadonlyArray<A>>>,
  ) => Record<string, B>
  <A, B>(
    self: Readonly<Record<string, ReadonlyArray<A>>>,
    aggregator: (current: A, key: string, accumulator: Option.Option<B>) => B,
  ): Record<string, B>
} = Function.dual(2, <A, B>(
  self: Readonly<Record<string, ReadonlyArray<A>>>,
  aggregator: (current: A, key: string, accumulator: Option.Option<B>) => B,
): Record<string, B> =>
  Record.map(self, (values, key) =>
    Option.getOrThrow(
      Arr.reduce(values, Option.none<B>(), (acc, current) => Option.some(aggregator(current, key, acc))),
    )))

/** Reduces every group of a record of arrays from `initial`. */
export const reduceGroups: {
  <A, B>(reducer: (accumulator: B, current: A) => B, initial: B): (
    self: Readonly<Record<string, ReadonlyArray<A>>>,
  ) => Record<string, B>
  <A, B>(self: Readonly<Record<string, ReadonlyArray<A>>>, reducer: (accumulator: B, current: A) => B, initial: B): Record<
    string,
    B
  >
} = Function.dual(3, <A, B>(
  self: Readonly<Record<string, ReadonlyArray<A>>>,
  reducer: (accumulator: B, current: A) => B,
  initial: B,
): Record<string, B> => Record.map(self, (values) => Arr.reduce(values, initial, reducer)))

/** Keeps the entries (`[key, value]` tuples) matching `predicate`. */
export const filterEntries: {
  <A>(predicate: (entry: [string, A]) => boolean): (self: Readonly<Record<string, A>>) => Record<string, A>
  <A>(self: Readonly<Record<string, A>>, predicate: (entry: [string, A]) => boolean): Record<string, A>
} = Function.dual(2, <A>(self: Readonly<Record<string, A>>, predicate: (entry: [string, A]) => boolean) =>
  stdFilterEntries(self, predicate))

/** Keeps the entries whose key matches `predicate`. */
export const filterKeys: {
  (predicate: (key: string) => boolean): <A>(self: Readonly<Record<string, A>>) => Record<string, A>
  <A>(self: Readonly<Record<string, A>>, predicate: (key: string) => boolean): Record<string, A>
} = Function.dual(2, <A>(self: Readonly<Record<string, A>>, predicate: (key: string) => boolean) =>
  stdFilterKeys(self, predicate))

/** Keeps the entries whose value matches `predicate`. `Record.filter`. */
export const filterValues: {
  <A>(predicate: (value: A, key: string) => boolean): (self: Readonly<Record<string, A>>) => Record<string, A>
  <A>(self: Readonly<Record<string, A>>, predicate: (value: A, key: string) => boolean): Record<string, A>
} = Function.dual(2, <A>(self: Readonly<Record<string, A>>, predicate: (value: A, key: string) => boolean) =>
  Record.filter(self, predicate))

/** Splits a record into `[matching, rest]` by an entry predicate (std's order; `Record.partition` returns `[rest, matching]`). */
export const partitionEntries: {
  <A>(predicate: (entry: [string, A]) => boolean): (
    self: Readonly<Record<string, A>>,
  ) => [match: Record<string, A>, rest: Record<string, A>]
  <A>(
    self: Readonly<Record<string, A>>,
    predicate: (entry: [string, A]) => boolean,
  ): [match: Record<string, A>, rest: Record<string, A>]
} = Function.dual(2, <A>(self: Readonly<Record<string, A>>, predicate: (entry: [string, A]) => boolean) =>
  stdPartitionEntries(self, predicate))

/** Maps every entry (`[key, value]` tuple) to a new entry. */
export const mapEntries: {
  <A, B>(f: (entry: [string, A]) => [string, B]): (self: Readonly<Record<string, A>>) => Record<string, B>
  <A, B>(self: Readonly<Record<string, A>>, f: (entry: [string, A]) => [string, B]): Record<string, B>
} = Function.dual(2, <A, B>(self: Readonly<Record<string, A>>, f: (entry: [string, A]) => [string, B]) =>
  stdMapEntries(self, f))

/** Maps every key; later entries win on collisions. `Record.mapKeys`. */
export const mapKeys: {
  <A>(f: (key: string, value: A) => string): (self: Readonly<Record<string, A>>) => Record<string, A>
  <A>(self: Readonly<Record<string, A>>, f: (key: string, value: A) => string): Record<string, A>
} = Function.dual(2, <A>(self: Readonly<Record<string, A>>, f: (key: string, value: A) => string) =>
  Record.mapKeys(self, f))

/** Maps every value. `Record.map`. */
export const mapValues: {
  <K extends string, A, B>(f: (value: A, key: K) => B): (self: Readonly<Record<K, A>>) => Record<K, B>
  <K extends string, A, B>(self: Readonly<Record<K, A>>, f: (value: A, key: K) => B): Record<K, B>
} = Function.dual(2, <K extends string, A, B>(self: Readonly<Record<K, A>>, f: (value: A, key: K) => B) =>
  Record.map(self, f))

/** Whether some value of the record is `value` (SameValueZero). */
export const includesValue: {
  <A>(value: A): (self: Readonly<Record<string, A>>) => boolean
  <A>(self: Readonly<Record<string, A>>, value: A): boolean
} = Function.dual(2, <A>(self: Readonly<Record<string, A>>, value: A): boolean => stdIncludesValue(self, value))

/** Swaps keys and values; later keys win on duplicate values. */
export const invert = <T extends Record<PropertyKey, PropertyKey>>(self: Readonly<T>): InvertResult<T> =>
  stdInvert(self)

/** Groups the keys by `f(value)`. */
export const invertBy: {
  <R extends Record<PropertyKey, PropertyKey>>(f: (value: R[keyof R]) => PropertyKey): (
    self: Readonly<R>,
  ) => Record<PropertyKey, Array<keyof R>>
  <R extends Record<PropertyKey, PropertyKey>>(
    self: Readonly<R>,
    f: (value: R[keyof R]) => PropertyKey,
  ): Record<PropertyKey, Array<keyof R>>
} = Function.dual(2, <R extends Record<PropertyKey, PropertyKey>>(self: Readonly<R>, f: (value: R[keyof R]) => PropertyKey) =>
  stdInvertBy(self, f as (key: PropertyKey) => PropertyKey) as Record<PropertyKey, Array<keyof R>>)

/** The object with only `keys`. `Struct.pick`. */
export const pick: {
  <S extends object, const Keys extends ReadonlyArray<keyof S>>(keys: Keys): (self: S) => Pick<S, Keys[number]>
  <S extends object, const Keys extends ReadonlyArray<keyof S>>(self: S, keys: Keys): Pick<S, Keys[number]>
} = Struct.pick

/** The object without `keys`. `Struct.omit`. */
export const omit: {
  <S extends object, const Keys extends ReadonlyArray<keyof S>>(keys: Keys): (self: S) => Omit<S, Keys[number]>
  <S extends object, const Keys extends ReadonlyArray<keyof S>>(self: S, keys: Keys): Omit<S, Keys[number]>
} = Struct.omit

/**
 * Merges two records deeply: nested records merge recursively; arrays, sets
 * and maps are concatenated or replaced as `options` say (default: merged);
 * other values from `other` win. Data-first only.
 */
export const deepMerge: typeof stdDeepMerge = stdDeepMerge
