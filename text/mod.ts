// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * Text helpers from `@std/text`: case conversion, string similarity,
 * truncation, dedenting, slugs and trimming, with Effect conventions.
 *
 * Case conversion stays std's. Effect's `String.camelCase`, `pascalCase`,
 * `snakeCase`, `kebabCase` and `constantCase` agree with std on ASCII input,
 * but they split words on `[A-Za-z0-9]` only and so drop every other letter:
 * `String.camelCase("ÉcoleFrançaise")` is `"coleFranAise"`, and Cyrillic or
 * CJK input becomes `""`. Std's functions split on Unicode letter and number
 * classes (`"écoleFrançaise"`), so they are kept.
 *
 * What changes over std: {@linkcode closestString} returns an `Option`
 * instead of throwing on an empty list, {@linkcode compareSimilarity} is an
 * `Order<string>` usable with `Array.sort`, and the two-argument helpers
 * ({@linkcode levenshteinDistance}, {@linkcode truncate}, {@linkcode trimBy}
 * ...) are dual, so they work in a `pipe`.
 *
 * ```ts
 * import { Array, Option, pipe } from "effect"
 * import * as Text from "@mikepage/flareosaur/text"
 *
 * Text.toCamelCase("deno is awesome") // "denoIsAwesome"
 * Text.closestString("hep", ["hi", "help", "hello"]) // Option.some("help")
 * pipe(["hi", "help", "hello"], Array.sort(Text.compareSimilarity("hep"))) // ["help", "hi", "hello"]
 * pipe("Hello, world!", Text.truncate(8)) // "Hello, …"
 * Text.slugify("Hello, World!") // "hello-world"
 * ```
 *
 * @module
 */

import { Array as Arr, Function, Option, Order } from "effect"
import { closestString as stdClosestString } from "./_std/closest_string.ts"
import { compareSimilarity as stdCompareSimilarity } from "./_std/compare_similarity.ts"
import { levenshteinDistance as stdLevenshteinDistance } from "./_std/levenshtein_distance.ts"
import { toCamelCase as stdToCamelCase } from "./_std/to_camel_case.ts"
import { toKebabCase as stdToKebabCase } from "./_std/to_kebab_case.ts"
import { toPascalCase as stdToPascalCase } from "./_std/to_pascal_case.ts"
import { toSnakeCase as stdToSnakeCase } from "./_std/to_snake_case.ts"
import { truncate as stdTruncate, type TruncateOptions } from "./_std/truncate.ts"
import { dedent as stdDedent } from "./_std/unstable_dedent.ts"
import { longestCommonPrefix as stdLongestCommonPrefix } from "./_std/unstable_longest_common_prefix.ts"
import { reverse as stdReverse, type ReverseOptions } from "./_std/unstable_reverse.ts"
import {
  ASCII_DIACRITICS_REGEXP,
  DIACRITICS_REGEXP,
  NON_ASCII_REGEXP,
  NON_WORD_REGEXP,
  slugify as stdSlugify,
  type SlugifyOptions,
} from "./_std/unstable_slugify.ts"
import { toConstantCase as stdToConstantCase } from "./_std/unstable_to_constant_case.ts"
import { type SentenceCaseOptions, toSentenceCase as stdToSentenceCase } from "./_std/unstable_to_sentence_case.ts"
import {
  type BaseTitleCaseOptions,
  type ExcludeWordConfig,
  type ExcludeWordFilter,
  type TitleCaseOptions,
  toTitleCase as stdToTitleCase,
  type TrailingCase,
} from "./_std/unstable_to_title_case.ts"
import { trimBy as stdTrimBy, trimEndBy as stdTrimEndBy, type TrimPattern, trimStartBy as stdTrimStartBy } from "./_std/unstable_trim_by.ts"

export type {
  BaseTitleCaseOptions,
  ExcludeWordConfig,
  ExcludeWordFilter,
  ReverseOptions,
  SentenceCaseOptions,
  SlugifyOptions,
  TitleCaseOptions,
  TrailingCase,
  TrimPattern,
  TruncateOptions,
}

/** Converts a string to camelCase (Unicode-aware; see the module docs). */
export const toCamelCase = (input: string): string => stdToCamelCase(input)

/** Converts a string to PascalCase (Unicode-aware). */
export const toPascalCase = (input: string): string => stdToPascalCase(input)

/** Converts a string to snake_case (Unicode-aware). */
export const toSnakeCase = (input: string): string => stdToSnakeCase(input)

/** Converts a string to kebab-case (Unicode-aware). */
export const toKebabCase = (input: string): string => stdToKebabCase(input)

/** Converts a string to CONSTANT_CASE (Unicode-aware). */
export const toConstantCase = (input: string): string => stdToConstantCase(input)

/**
 * Converts a string to Title Case, word by word, with locale-aware casing
 * and optional excluded (stop) words.
 */
export const toTitleCase = (input: string, options?: TitleCaseOptions): string => stdToTitleCase(input, options)

/** Converts a string to Sentence case: the first letter upper case, the rest lower case by default. */
export const toSentenceCase = (input: string, options?: SentenceCaseOptions): string =>
  stdToSentenceCase(input, options)

/** The Levenshtein (edit) distance between two strings. */
export const levenshteinDistance: {
  (that: string): (self: string) => number
  (self: string, that: string): number
} = Function.dual(2, (self: string, that: string): number => stdLevenshteinDistance(self, that))

/** Options for {@linkcode closestString}, {@linkcode compareSimilarity} and {@linkcode wordSimilaritySort}. */
export interface SimilarityOptions {
  /** Compare case-sensitively. Defaults to `false`. */
  readonly caseSensitive?: boolean | undefined
  /** The distance between two strings. Defaults to {@linkcode levenshteinDistance}. */
  readonly compareFn?: ((a: string, b: string) => number) | undefined
}

const stdOptions = (options?: SimilarityOptions) => ({
  caseSensitive: options?.caseSensitive ?? false,
  ...(options?.compareFn ? { compareFn: options.compareFn } : {}),
})

/**
 * The word of `possibleWords` closest to `givenWord`, or `None` when there
 * are no words. Ties go to the earliest word.
 */
export const closestString = (
  givenWord: string,
  possibleWords: Iterable<string>,
  options?: SimilarityOptions,
): Option.Option<string> => {
  const words = Arr.fromIterable(possibleWords)
  return Arr.isArrayNonEmpty(words) ? Option.some(stdClosestString(givenWord, words, stdOptions(options))) : Option.none()
}

/**
 * An `Order` that sorts strings by their distance to `givenWord`, closest
 * first.
 */
export const compareSimilarity = (givenWord: string, options?: SimilarityOptions): Order.Order<string> => {
  const compare = stdCompareSimilarity(givenWord, stdOptions(options))
  return Order.make((self, that) => Math.sign(compare(self, that)) as -1 | 0 | 1)
}

/** Sorts `possibleWords` by their distance to `givenWord`, closest first. Does not mutate the input. */
export const wordSimilaritySort = (
  givenWord: string,
  possibleWords: Iterable<string>,
  options?: SimilarityOptions,
): Array<string> => Arr.sort(possibleWords, compareSimilarity(givenWord, options))

/**
 * Truncates a string to at most `maxLength` UTF-16 code units, marking the
 * cut with `options.suffix` (default `"…"`) at the `"end"` (default),
 * `"middle"` or `"start"`. Surrogate pairs are never split. A fractional or
 * negative `maxLength` is floored and clamped to 0.
 */
export const truncate: {
  (maxLength: number, options?: TruncateOptions): (self: string) => string
  (self: string, maxLength: number, options?: TruncateOptions): string
} = Function.dual(
  (args: IArguments) => typeof args[0] === "string",
  (self: string, maxLength: number, options?: TruncateOptions): string =>
    stdTruncate(self, Number.isFinite(maxLength) ? Math.max(0, Math.floor(maxLength)) : 0, options),
)

/**
 * Removes the indentation common to every non-blank line, and the leading
 * and trailing line break. Works as a function or a template tag.
 *
 * ```ts
 * import * as Text from "@mikepage/flareosaur/text"
 *
 * Text.dedent`
 *   a
 *     b
 * ` // "a\n  b"
 * ```
 */
export function dedent(input: string): string
export function dedent(input: TemplateStringsArray, ...values: ReadonlyArray<unknown>): string
export function dedent(input: TemplateStringsArray | string, ...values: ReadonlyArray<unknown>): string {
  return typeof input === "string" ? stdDedent(input) : stdDedent(input, ...values)
}

/** The regular expressions std offers for {@linkcode SlugifyOptions}'s `strip` option. */
export const SlugifyStrip = {
  /** Strips non-word characters, keeping letters, marks, numbers and `-` (the default). */
  nonWord: NON_WORD_REGEXP,
  /** Also strips diacritics. */
  diacritics: DIACRITICS_REGEXP,
  /** Strips diacritics from ASCII letters only. */
  asciiDiacritics: ASCII_DIACRITICS_REGEXP,
  /** Keeps ASCII letters, digits and `-` only. */
  nonAscii: NON_ASCII_REGEXP,
} as const

/** Converts a string to a URL slug: lower case words joined by `-`. */
export const slugify = (input: string, options?: Partial<SlugifyOptions>): string => stdSlugify(input, options)

/** Reverses a string, keeping surrogate pairs and combining marks intact unless `handleUnicode` is `false`. */
export const reverse = (input: string, options?: Partial<ReverseOptions>): string => stdReverse(input, options)

/** The longest prefix shared by every string. */
export const longestCommonPrefix = (strings: Iterable<string>): string =>
  stdLongestCommonPrefix(Arr.fromIterable(strings))

/** Repeatedly removes `pattern` (a string, several strings, or a RegExp) from both ends of a string. */
export const trimBy: {
  (pattern: TrimPattern): (self: string) => string
  (self: string, pattern: TrimPattern): string
} = Function.dual(2, (self: string, pattern: TrimPattern): string => stdTrimBy(self, pattern))

/** Repeatedly removes `pattern` from the start of a string. */
export const trimStartBy: {
  (pattern: TrimPattern): (self: string) => string
  (self: string, pattern: TrimPattern): string
} = Function.dual(2, (self: string, pattern: TrimPattern): string => stdTrimStartBy(self, pattern))

/** Repeatedly removes `pattern` from the end of a string. */
export const trimEndBy: {
  (pattern: TrimPattern): (self: string) => string
  (self: string, pattern: TrimPattern): string
} = Function.dual(2, (self: string, pattern: TrimPattern): string => stdTrimEndBy(self, pattern))
