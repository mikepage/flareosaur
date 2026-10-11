// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * Assertions for tests, built for Effect.
 *
 * The plain assertions (`assertEquals`, `assertThrows`, ...) keep the names
 * and messages of `@std/assert`, with Deno-style diffs on any runtime. They
 * throw an {@linkcode AssertionError}, a `Schema.TaggedError`, so inside
 * `Effect.gen` a failed assertion fails the test with a readable cause.
 * Values that implement Effect's `Equal` (Data classes, `Option`, `HashMap`,
 * ...) are compared with `Equal.equals`.
 *
 * The Effect assertions check how an effect ends: {@linkcode assertSucceeds},
 * {@linkcode assertFails}, {@linkcode assertFailsWithTag} and
 * {@linkcode assertDies} run the effect and return its value, error or
 * defect, failing with an `AssertionError` otherwise.
 *
 * ```ts no-assert
 * import { Effect, Option } from "effect"
 * import { it } from "@mikepage/flareosaur/testing"
 * import { assertEquals, assertFailsWithTag } from "@mikepage/flareosaur/assert"
 *
 * it.effect("parses", () =>
 *   Effect.gen(function*() {
 *     assertEquals(Option.some({ a: [1] }), Option.some({ a: [1] }))
 *     const error = yield* assertFailsWithTag(Effect.fail({ _tag: "NotFound" as const }), "NotFound")
 *     assertEquals(error._tag, "NotFound")
 *   }))
 * ```
 *
 * @module
 */

import { Cause, Effect, Equal, Exit, Option, Result, Schema } from "effect"
import * as std from "./_std/mod.ts"
import { AssertionError as StdAssertionError } from "./_std/assertion_error.ts"
import { format } from "../internal/Inspect.ts"

const AssertionErrorBase: Schema.Class<
  AssertionError,
  Schema.TaggedStruct<"AssertionError", {
    readonly message: Schema.String
  }>,
  Cause.YieldableError
> = Schema.TaggedError<AssertionError>()("AssertionError", {
  message: Schema.String,
})

/** The error every failed assertion throws or fails with. */
export class AssertionError extends AssertionErrorBase {}

// Runs a std assertion and rethrows its error as this module's AssertionError.
const guard = <A>(f: () => A): A => {
  try {
    return f()
  } catch (error) {
    if (error instanceof StdAssertionError) throw new AssertionError({ message: error.message })
    throw error
  }
}

const bothEqual = (a: unknown, b: unknown): boolean => Equal.isEqual(a) && Equal.isEqual(b) && Equal.equals(a, b)

/**
 * Deep equality, as used by {@linkcode assertEquals}: `Equal.equals` for
 * values that implement `Equal`, structural equality otherwise.
 */
export const equal = (a: unknown, b: unknown): boolean => bothEqual(a, b) || std.equal(a, b)

/** Asserts that `expr` is truthy. */
export function assert(expr: unknown, msg = ""): asserts expr {
  guard(() => std.assert(expr, msg))
}

/** Asserts that `expr` is falsy. */
export function assertFalse(expr: unknown, msg = ""): asserts expr is false | 0 | 0n | "" | null | undefined {
  guard(() => std.assertFalse(expr, msg))
}

/** Asserts deep equality of `actual` and `expected`, with a diff when they differ. */
export function assertEquals<T>(actual: unknown, expected: T, msg?: string): asserts actual is T {
  if (bothEqual(actual, expected)) return
  guard(() => std.assertEquals(actual, expected, msg))
}

/** Asserts that `actual` and `expected` are not deeply equal. */
export function assertNotEquals<T>(actual: T, expected: T, msg?: string): void {
  if (bothEqual(actual, expected)) {
    throw new AssertionError({ message: msg ?? `Expected actual: ${format(actual)} not to be: ${format(expected)}.` })
  }
  guard(() => std.assertNotEquals(actual, expected, msg))
}

/** Asserts `Object.is` equality. */
export function assertStrictEquals<T>(actual: unknown, expected: T, msg?: string): asserts actual is T {
  guard(() => std.assertStrictEquals(actual, expected, msg))
}

/** Asserts that `actual` and `expected` are not the same value. */
export function assertNotStrictEquals<T>(actual: T, expected: T, msg?: string): void {
  guard(() => std.assertNotStrictEquals(actual, expected, msg))
}

/** Asserts that a number is within `tolerance` of the expected one. */
export function assertAlmostEquals(actual: number, expected: number, tolerance?: number, msg?: string): void {
  guard(() => std.assertAlmostEquals(actual, expected, tolerance, msg))
}

/** Asserts that `actual` is neither `null` nor `undefined`. */
export function assertExists<T>(actual: T, msg?: string): asserts actual is NonNullable<T> {
  guard(() => std.assertExists(actual, msg))
}

/** Asserts that `actual` is an instance of `expectedType`. */
export function assertInstanceOf<T extends abstract new(...args: any) => any>(
  actual: unknown,
  expectedType: T,
  msg = "",
): asserts actual is InstanceType<T> {
  guard(() => std.assertInstanceOf(actual, expectedType, msg))
}

/** Asserts that `actual` is not an instance of `unexpectedType`. */
export function assertNotInstanceOf<A, T>(
  actual: A,
  unexpectedType: abstract new(...args: any[]) => T,
  msg?: string,
): asserts actual is Exclude<A, T> {
  guard(() => std.assertNotInstanceOf(actual, unexpectedType, msg))
}

/** Asserts that a string matches a regular expression. */
export function assertMatch(actual: string, expected: RegExp, msg?: string): void {
  guard(() => std.assertMatch(actual, expected, msg))
}

/** Asserts that a string does not match a regular expression. */
export function assertNotMatch(actual: string, expected: RegExp, msg?: string): void {
  guard(() => std.assertNotMatch(actual, expected, msg))
}

/** Asserts that a string contains another. */
export function assertStringIncludes(actual: string, expected: string, msg?: string): void {
  guard(() => std.assertStringIncludes(actual, expected, msg))
}

/** Asserts that an array includes every expected value (deep equality). */
export function assertArrayIncludes<T>(actual: ArrayLike<T>, expected: ArrayLike<T>, msg?: string): void {
  guard(() => std.assertArrayIncludes(actual, expected, msg))
}

/** Asserts that `actual` has at least the properties of `expected`. */
export function assertObjectMatch(
  actual: Record<PropertyKey, any>,
  expected: Record<PropertyKey, unknown>,
  msg?: string,
): void {
  guard(() => std.assertObjectMatch(actual, expected, msg))
}

/** Asserts `actual > expected`. */
export function assertGreater<T>(actual: T, expected: T, msg?: string): void {
  guard(() => std.assertGreater(actual, expected, msg))
}

/** Asserts `actual >= expected`. */
export function assertGreaterOrEqual<T>(actual: T, expected: T, msg?: string): void {
  guard(() => std.assertGreaterOrEqual(actual, expected, msg))
}

/** Asserts `actual < expected`. */
export function assertLess<T>(actual: T, expected: T, msg?: string): void {
  guard(() => std.assertLess(actual, expected, msg))
}

/** Asserts `actual <= expected`. */
export function assertLessOrEqual<T>(actual: T, expected: T, msg?: string): void {
  guard(() => std.assertLessOrEqual(actual, expected, msg))
}

/** Asserts that `error` is an Error, optionally of a class and containing a message. */
export function assertIsError<E extends Error = Error>(
  error: unknown,
  ErrorClass?: abstract new(...args: any[]) => E,
  msgMatches?: string | RegExp,
  msg?: string,
): asserts error is E {
  guard(() => std.assertIsError(error, ErrorClass, msgMatches, msg))
}

/** Asserts that `fn` throws, and returns what it threw. */
export function assertThrows(fn: () => unknown, msg?: string): unknown
export function assertThrows<E extends Error = Error>(
  fn: () => unknown,
  ErrorClass: abstract new(...args: any[]) => E,
  msgIncludes?: string,
  msg?: string,
): E
export function assertThrows(
  fn: () => unknown,
  errorClassOrMsg?: string | (abstract new(...args: any[]) => Error),
  msgIncludes?: string,
  msg?: string,
): unknown {
  return guard(() => std.assertThrows(fn, errorClassOrMsg as any, msgIncludes, msg))
}

/** Asserts that `fn` returns a promise that rejects, and returns the reason. */
export function assertRejects(fn: () => PromiseLike<unknown>, msg?: string): Promise<unknown>
export function assertRejects<E extends Error = Error>(
  fn: () => PromiseLike<unknown>,
  ErrorClass: abstract new(...args: any[]) => E,
  msgIncludes?: string,
  msg?: string,
): Promise<E>
export async function assertRejects(
  fn: () => PromiseLike<unknown>,
  errorClassOrMsg?: string | (abstract new(...args: any[]) => Error),
  msgIncludes?: string,
  msg?: string,
): Promise<unknown> {
  try {
    return await std.assertRejects(fn, errorClassOrMsg as any, msgIncludes, msg)
  } catch (error) {
    if (error instanceof StdAssertionError) throw new AssertionError({ message: error.message })
    throw error
  }
}

/** Fails the test unconditionally. */
export const fail = (msg?: string): never => guard(() => std.fail(msg))

/** Marks code that should never run. */
export const unreachable = (msg?: string): never => guard(() => std.unreachable(msg))

/** Marks code that is not written yet. */
export const unimplemented = (msg?: string): never => guard(() => std.unimplemented(msg))

/** Asserts that an `Option` is `Some` and returns its value. */
export const assertSome = <A>(option: Option.Option<A>, msg?: string): A => {
  if (Option.isSome(option)) return option.value
  throw new AssertionError({ message: msg ?? "Expected Some, got None." })
}

/** Asserts that an `Option` is `None`. */
export const assertNone = <A>(option: Option.Option<A>, msg?: string): void => {
  if (Option.isSome(option)) {
    throw new AssertionError({ message: msg ?? `Expected None, got Some(${format(option.value)}).` })
  }
}

/** Asserts that a `Result` is a success and returns its value. */
export const assertSuccess = <A, E>(result: Result.Result<A, E>, msg?: string): A => {
  if (Result.isSuccess(result)) return result.success
  throw new AssertionError({ message: msg ?? `Expected a success, got a failure: ${format(result.failure)}` })
}

/** Asserts that a `Result` is a failure and returns its error. */
export const assertFailure = <A, E>(result: Result.Result<A, E>, msg?: string): E => {
  if (Result.isFailure(result)) return result.failure
  throw new AssertionError({ message: msg ?? `Expected a failure, got a success: ${format(result.success)}` })
}

const describeExit = (exit: Exit.Exit<unknown, unknown>): string =>
  Exit.isSuccess(exit) ? `succeeded with ${format(exit.value)}` : `ended with:\n${Cause.pretty(exit.cause)}`

/** Runs `effect`, asserts that it succeeds, and returns its value. */
export const assertSucceeds = <A, E, R>(effect: Effect.Effect<A, E, R>, msg?: string): Effect.Effect<A, AssertionError, R> =>
  Effect.flatMap(Effect.exit(effect), (exit) =>
    Exit.isSuccess(exit)
      ? Effect.succeed(exit.value)
      : Effect.fail(new AssertionError({ message: msg ?? `Expected the effect to succeed, but it ${describeExit(exit)}` })))

/** Runs `effect`, asserts that it fails with an expected error, and returns the error. */
export const assertFails = <A, E, R>(effect: Effect.Effect<A, E, R>, msg?: string): Effect.Effect<E, AssertionError, R> =>
  Effect.flatMap(Effect.exit(effect), (exit) => {
    if (Exit.isFailure(exit)) {
      const error = Cause.findErrorOption(exit.cause)
      if (Option.isSome(error)) return Effect.succeed(error.value)
    }
    return Effect.fail(new AssertionError({ message: msg ?? `Expected the effect to fail, but it ${describeExit(exit)}` }))
  })

/** Runs `effect`, asserts that it fails with an error tagged `tag`, and returns the error. */
export const assertFailsWithTag = <A, E, R, K extends E extends { readonly _tag: string } ? E["_tag"] : never>(
  effect: Effect.Effect<A, E, R>,
  tag: K,
  msg?: string,
): Effect.Effect<Extract<E, { readonly _tag: K }>, AssertionError, R> =>
  Effect.flatMap(assertFails(effect, msg), (error) =>
    (error as { readonly _tag?: unknown })._tag === tag
      ? Effect.succeed(error as Extract<E, { readonly _tag: K }>)
      : Effect.fail(new AssertionError({ message: msg ?? `Expected a ${tag} error, got ${format(error)}` })))

/** Runs `effect`, asserts that it dies with a defect, and returns the defect. */
export const assertDies = <A, E, R>(effect: Effect.Effect<A, E, R>, msg?: string): Effect.Effect<unknown, AssertionError, R> =>
  Effect.flatMap(Effect.exit(effect), (exit) => {
    if (Exit.isFailure(exit)) {
      const defect = Cause.findDefect(exit.cause)
      if (Result.isSuccess(defect)) return Effect.succeed(defect.success)
    }
    return Effect.fail(new AssertionError({ message: msg ?? `Expected the effect to die, but it ${describeExit(exit)}` }))
  })
