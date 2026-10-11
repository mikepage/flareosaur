// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * Regular expression helpers from `@std/regexp`, on Effect.
 *
 * - {@linkcode escape} is Effect's `RegExp.escape`, which escapes the
 *   characters that are special in a pattern.
 * - {@linkcode escapeStrict} is std's escape, which also escapes characters
 *   that are only special inside `v`-flag character classes and a leading
 *   alphanumeric, so the result is safe to splice anywhere in a pattern.
 * - {@linkcode replaceAllEffect} is std's `replaceAllAsync` with a replacer
 *   that returns an `Effect`, so replacements can use services, fail with
 *   typed errors and run with bounded concurrency.
 *
 * ```ts
 * import { Effect } from "effect"
 * import * as RegExps from "@mikepage/flareosaur/regexp"
 *
 * const pattern = new RegExp(RegExps.escape("1+1=2"), "g") // /1\+1=2/g
 *
 * const program = RegExps.replaceAllEffect("a1 b2", /\d/g, (digit) => Effect.succeed(String(Number(digit) * 10)))
 * // Effect<string>: "a10 b20"
 * ```
 *
 * @module
 */

import { Effect, Function, RegExp as EffectRegExp, type Types } from "effect"
import { escape as stdEscape } from "./_std/escape.ts"

/** Escapes the characters that are special in a regular expression (Effect's `RegExp.escape`). */
export const escape: (string: string) => string = EffectRegExp.escape

/**
 * Escapes a string with std's rules: every character reserved in any flag
 * mode (including `v`-flag class punctuators) and a leading alphanumeric,
 * which could otherwise extend a preceding escape such as `\0` or `\x1`.
 */
export const escapeStrict = (string: string): string => stdEscape(string)

/** Options for {@linkcode replaceAllEffect}. */
export interface ReplaceAllOptions {
  /** How many replacer effects run at once. Defaults to one at a time. */
  readonly concurrency?: Types.Concurrency | undefined
}

/**
 * The replacer of {@linkcode replaceAllEffect}: called like the callback of
 * `String.prototype.replaceAll` (the match, then the groups, offset, input
 * and named groups), it returns the replacement as an Effect.
 */
export type Replacer<E, R> = (substring: string, ...args: Array<any>) => Effect.Effect<string, E, R>

/**
 * Replaces every match of `searchValue` in `text` with the string produced by
 * the replacer effect. Fails with the first error a replacer fails with.
 * A `RegExp` search value needs the `g` flag, as with `replaceAll`.
 *
 * The Effect version of std's `replaceAllAsync`.
 */
export const replaceAllEffect: {
  <E, R>(
    searchValue: RegExp | string,
    replacer: Replacer<E, R>,
    options?: ReplaceAllOptions,
  ): (text: string) => Effect.Effect<string, E, R>
  <E, R>(
    text: string,
    searchValue: RegExp | string,
    replacer: Replacer<E, R>,
    options?: ReplaceAllOptions,
  ): Effect.Effect<string, E, R>
} = Function.dual(
  (args: IArguments) => typeof args[2] === "function",
  <E, R>(
    text: string,
    searchValue: RegExp | string,
    replacer: Replacer<E, R>,
    options?: ReplaceAllOptions,
  ): Effect.Effect<string, E, R> =>
    Effect.suspend(() => {
      const calls: Array<Array<any>> = []
      text.replaceAll(searchValue, (...args) => {
        calls.push(args)
        return ""
      })
      return Effect.forEach(calls, (args) => replacer(...(args as [string, ...Array<any>])), {
        concurrency: options?.concurrency,
      }).pipe(
        Effect.map((replacements) => {
          let i = 0
          return text.replaceAll(searchValue, () => replacements[i++]!)
        }),
      )
    }),
)
