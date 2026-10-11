// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * Semantic versioning (https://semver.org) as Effect data: a {@linkcode SemVer}
 * Schema class with `Order` and `Equivalence` instances, npm-style ranges,
 * and a Schema codec from version strings.
 *
 * Effect has no semver support. This module wraps `@std/semver`'s parser,
 * comparator and range logic: parsing returns a `Result` failing with a
 * {@linkcode SemVerError}, queries that may find nothing return `Option`,
 * comparisons are an `Order`, and binary operations are pipeable.
 *
 * ```ts
 * import { Array, Result } from "effect"
 * import * as SemVer from "@mikepage/flareosaur/semver"
 *
 * const version = Result.getOrThrow(SemVer.parse("1.2.3"))
 * const range = Result.getOrThrow(SemVer.parseRange(">=1.0.0 <2.0.0"))
 *
 * SemVer.satisfies(version, range) // true
 * SemVer.format(Result.getOrThrow(SemVer.increment(version, "minor"))) // "1.3.0"
 * Array.sort(["2.0.0", "1.0.0"].map((s) => Result.getOrThrow(SemVer.parse(s))), SemVer.Order)
 * ```
 *
 * @module
 */

import { Effect, Equivalence as Eq, Function, Option, Order as Ord, Result, Schema, SchemaGetter, SchemaIssue, SchemaTransformation } from "effect"
import { compare as stdCompare } from "./_std/compare.ts"
import { difference as stdDifference } from "./_std/difference.ts"
import { format as stdFormat } from "./_std/format.ts"
import { formatRange as stdFormatRange } from "./_std/format_range.ts"
import { greaterThanRange as stdGreaterThanRange } from "./_std/greater_than_range.ts"
import { increment as stdIncrement, type IncrementOptions } from "./_std/increment.ts"
import { isRange as stdIsRange } from "./_std/is_range.ts"
import { lessThanRange as stdLessThanRange } from "./_std/less_than_range.ts"
import { parse as stdParse } from "./_std/parse.ts"
import { parseRange as stdParseRange } from "./_std/parse_range.ts"
import { rangeIntersects as stdRangeIntersects } from "./_std/range_intersects.ts"
import { satisfies as stdSatisfies } from "./_std/satisfies.ts"
import type * as Std from "./_std/types.ts"

export type { IncrementOptions }

/** A release type, as used by {@linkcode increment} and {@linkcode difference}. */
export type ReleaseType = Std.ReleaseType

/** A comparator operator. `undefined` means equality. */
export type Operator = Std.Operator

/** One comparator of a range: a version bound with an operator. */
export type Comparator = Readonly<Std.Comparator>

/** A range: a union (outer array) of intersections (inner arrays) of comparators. */
export type Range = ReadonlyArray<ReadonlyArray<Comparator>>

/** A version or range could not be parsed, or a version could not be incremented. */
export class SemVerError extends Schema.TaggedError<SemVerError>()("SemVerError", {
  kind: Schema.Literals(["Parse", "ParseRange", "Increment"]),
  message: Schema.String,
  input: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

/**
 * A semantic version. Build metadata does not take part in
 * {@linkcode Order} or {@linkcode Equivalence}.
 */
export class SemVer extends Schema.Class<SemVer>("flareosaur/semver/SemVer")({
  major: NonNegativeInt,
  minor: NonNegativeInt,
  patch: NonNegativeInt,
  prerelease: Schema.Array(Schema.Union([Schema.String, NonNegativeInt])),
  build: Schema.Array(Schema.String),
}) {
  /** The version as a string, e.g. `"1.2.3-beta.1+build"`. */
  override toString(): string {
    return format(this)
  }
}

// std's functions take mutable arrays but do not mutate them.
const std = (version: SemVer): Std.SemVer => version as unknown as Std.SemVer
const stdRange = (range: Range): Std.Range => range as Std.Range

const fromStd = (version: Std.SemVer): SemVer =>
  new SemVer({
    major: version.major,
    minor: version.minor,
    patch: version.patch,
    prerelease: version.prerelease ?? [],
    build: version.build ?? [],
  })

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

/** The parts of a version. */
export interface SemVerParts {
  readonly major: number
  readonly minor: number
  readonly patch: number
  readonly prerelease: ReadonlyArray<string | number>
  readonly build: ReadonlyArray<string>
}

/** Makes a version from its parts. Throws on negative or fractional numbers. */
export const make = (parts: {
  readonly major: number
  readonly minor: number
  readonly patch: number
  readonly prerelease?: ReadonlyArray<string | number> | undefined
  readonly build?: ReadonlyArray<string> | undefined
}): SemVer =>
  new SemVer({
    major: parts.major,
    minor: parts.minor,
    patch: parts.patch,
    prerelease: parts.prerelease ?? [],
    build: parts.build ?? [],
  })

/** Parses a version string, e.g. `"1.2.3-beta.1+build"`. Surrounding whitespace is ignored. */
export const parse = (input: string): Result.Result<SemVer, SemVerError> =>
  Result.try({
    try: () => fromStd(stdParse(input)),
    catch: (cause) => new SemVerError({ kind: "Parse", message: message(cause), input, cause }),
  })

/** Parses an npm-style range, e.g. `"^1.2.3 || >=2.0.0 <3.0.0-0"`, `"~1.2"` or `"1.x"`. */
export const parseRange = (input: string): Result.Result<Range, SemVerError> =>
  Result.try({
    try: (): Range => stdParseRange(input),
    catch: (cause) => new SemVerError({ kind: "ParseRange", message: message(cause), input, cause }),
  })

/** Whether a string is a valid version. */
export const canParse = (input: string): boolean => Result.isSuccess(parse(input))

/** Whether a value is a {@linkcode SemVer}. */
export const isSemVer = (input: unknown): input is SemVer => input instanceof SemVer

/** Whether a value is a valid {@linkcode Range}. */
export const isRange = (input: unknown): input is Range => stdIsRange(input)

/** Formats a version as a string. */
export const format = (version: SemVer): string => stdFormat(std(version))

/** Formats a range as a string. */
export const formatRange = (range: Range): string => stdFormatRange(stdRange(range))

/** Orders versions by precedence (semver section 11); build metadata is ignored. */
export const Order: Ord.Order<SemVer> = Ord.make((self, that) => stdCompare(std(self), std(that)))

/** Versions of equal precedence; build metadata is ignored. */
export const Equivalence: Eq.Equivalence<SemVer> = Eq.make((self, that) => Order(self, that) === 0)

/** Whether `self` has higher precedence than `that`. */
export const greaterThan: {
  (that: SemVer): (self: SemVer) => boolean
  (self: SemVer, that: SemVer): boolean
} = Ord.isGreaterThan(Order)

/** Whether `self` has higher or equal precedence than `that`. */
export const greaterOrEqual: {
  (that: SemVer): (self: SemVer) => boolean
  (self: SemVer, that: SemVer): boolean
} = Ord.isGreaterThanOrEqualTo(Order)

/** Whether `self` has lower precedence than `that`. */
export const lessThan: {
  (that: SemVer): (self: SemVer) => boolean
  (self: SemVer, that: SemVer): boolean
} = Ord.isLessThan(Order)

/** Whether `self` has lower or equal precedence than `that`. */
export const lessOrEqual: {
  (that: SemVer): (self: SemVer) => boolean
  (self: SemVer, that: SemVer): boolean
} = Ord.isLessThanOrEqualTo(Order)

/** Whether two versions have equal precedence. */
export const equals: {
  (that: SemVer): (self: SemVer) => boolean
  (self: SemVer, that: SemVer): boolean
} = Function.dual(2, (self: SemVer, that: SemVer): boolean => Equivalence(self, that))

/** The greater of two versions. */
export const max: {
  (that: SemVer): (self: SemVer) => SemVer
  (self: SemVer, that: SemVer): SemVer
} = Ord.max(Order)

/** The lesser of two versions. */
export const min: {
  (that: SemVer): (self: SemVer) => SemVer
  (self: SemVer, that: SemVer): SemVer
} = Ord.min(Order)

/** The most significant part in which two versions differ; `None` when they are equal. */
export const difference: {
  (that: SemVer): (self: SemVer) => Option.Option<ReleaseType>
  (self: SemVer, that: SemVer): Option.Option<ReleaseType>
} = Function.dual(2, (self: SemVer, that: SemVer) => Option.fromNullishOr(stdDifference(std(self), std(that))))

/**
 * Increments a version by a release type. `pre*` types bump or set the
 * prerelease (`options.prerelease`, e.g. `"beta"`); `options.build` sets the
 * build metadata.
 */
export const increment: {
  (release: ReleaseType, options?: IncrementOptions): (self: SemVer) => Result.Result<SemVer, SemVerError>
  (self: SemVer, release: ReleaseType, options?: IncrementOptions): Result.Result<SemVer, SemVerError>
} = Function.dual(
  (args) => isSemVer(args[0]),
  (self: SemVer, release: ReleaseType, options?: IncrementOptions): Result.Result<SemVer, SemVerError> =>
    Result.try({
      try: () => fromStd(stdIncrement(std(self), release, options)),
      catch: (cause) => new SemVerError({ kind: "Increment", message: message(cause), input: format(self), cause }),
    }),
)

/** Whether a version satisfies a range. */
export const satisfies: {
  (range: Range): (self: SemVer) => boolean
  (self: SemVer, range: Range): boolean
} = Function.dual(2, (self: SemVer, range: Range): boolean => stdSatisfies(std(self), stdRange(range)))

/** Whether a version is greater than every version the range allows. */
export const greaterThanRange: {
  (range: Range): (self: SemVer) => boolean
  (self: SemVer, range: Range): boolean
} = Function.dual(2, (self: SemVer, range: Range): boolean => stdGreaterThanRange(std(self), stdRange(range)))

/** Whether a version is less than every version the range allows. */
export const lessThanRange: {
  (range: Range): (self: SemVer) => boolean
  (self: SemVer, range: Range): boolean
} = Function.dual(2, (self: SemVer, range: Range): boolean => stdLessThanRange(std(self), stdRange(range)))

/** The highest version that satisfies the range. */
export const maxSatisfying: {
  (range: Range): (versions: Iterable<SemVer>) => Option.Option<SemVer>
  (versions: Iterable<SemVer>, range: Range): Option.Option<SemVer>
} = Function.dual(2, (versions: Iterable<SemVer>, range: Range): Option.Option<SemVer> => {
  let best: SemVer | undefined
  for (const version of versions) {
    if (satisfies(version, range) && (best === undefined || greaterThan(version, best))) best = version
  }
  return Option.fromNullishOr(best)
})

/** The lowest version that satisfies the range. */
export const minSatisfying: {
  (range: Range): (versions: Iterable<SemVer>) => Option.Option<SemVer>
  (versions: Iterable<SemVer>, range: Range): Option.Option<SemVer>
} = Function.dual(2, (versions: Iterable<SemVer>, range: Range): Option.Option<SemVer> => {
  let best: SemVer | undefined
  for (const version of versions) {
    if (satisfies(version, range) && (best === undefined || lessThan(version, best))) best = version
  }
  return Option.fromNullishOr(best)
})

/** Whether two ranges overlap: some version satisfies both. */
export const rangeIntersects: {
  (that: Range): (self: Range) => boolean
  (self: Range, that: Range): boolean
} = Function.dual(2, (self: Range, that: Range): boolean => stdRangeIntersects(stdRange(self), stdRange(that)))

/** A transformation between a version string and the parts of a {@linkcode SemVer}. */
const versionTransformation = new SchemaTransformation.Transformation<SemVerParts, string>(
  SchemaGetter.transformEffect((input: string) =>
    Effect.try({
      try: () => {
        const v = stdParse(input)
        return { major: v.major, minor: v.minor, patch: v.patch, prerelease: v.prerelease ?? [], build: v.build ?? [] }
      },
      catch: (cause) => new SchemaIssue.InvalidValue({ message: message(cause) }, input),
    })
  ),
  SchemaGetter.transform((parts: SemVerParts) => stdFormat(parts as Std.SemVer)),
)

/**
 * A Schema that decodes a version string into a {@linkcode SemVer} and
 * encodes it back.
 *
 * ```ts
 * import { Schema } from "effect"
 * import * as SemVer from "@mikepage/flareosaur/semver"
 *
 * const Manifest = Schema.Struct({ version: SemVer.SemVerFromString })
 * Schema.decodeUnknownSync(Manifest)({ version: "1.2.3" }).version.minor // 2
 * ```
 */
export const SemVerFromString = Schema.String.pipe(Schema.decodeTo(SemVer, versionTransformation))
