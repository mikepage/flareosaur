// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * Spies and stubs for Effect tests, after `@std/testing/mock`.
 *
 * - {@linkcode spy} wraps a function and records every call: its arguments,
 *   its `this`, and how it ended as a `Result` (the returned value, or what
 *   it threw).
 * - {@linkcode spyEffect} wraps an effectful function and also records how
 *   each returned effect ended, as an `Exit`, once it has run.
 * - {@linkcode stub} replaces a method with a spy for the life of the current
 *   `Scope` (`Effect.acquireRelease`), so the original comes back when the
 *   test (every `it.effect` has a scope) or an `Effect.scoped` block ends.
 * - The assertions ({@linkcode assertSpyCalls}, {@linkcode assertSpyCall},
 *   ...) throw the `AssertionError` of `@mikepage/flareosaur/assert`, so they
 *   fail an `Effect.gen` test like any other assertion.
 *
 * ```ts no-assert
 * import { Effect } from "effect"
 * import { it } from "@mikepage/flareosaur/testing"
 * import { assertSpyCall, assertSpyCalls, stub } from "@mikepage/flareosaur/testing/mock"
 *
 * const clock = { now: () => Date.now() }
 *
 * it.effect("stubs a method for the test", () =>
 *   Effect.gen(function*() {
 *     const now = yield* stub(clock, "now", () => 0)
 *     clock.now()
 *     assertSpyCalls(now, 1)
 *     assertSpyCall(now, 0, { args: [], returned: 0 })
 *   })) // clock.now is restored here
 * ```
 *
 * @module
 */

import { Effect, Exit, Option, Result, Schema, type Scope } from "effect"
import { AssertionError, assertEquals, assertIsError } from "../assert/mod.ts"

/** A mock was misused: a method that cannot be stubbed, or a `returnsNext` that ran out. */
export class MockError extends Schema.TaggedError<MockError>()("MockError", {
  message: Schema.String,
}) {}

/** One recorded call of a {@linkcode Spy}. */
export interface SpyCall<Args extends ReadonlyArray<unknown> = Array<any>, Return = any> {
  /** The arguments. */
  readonly args: Args
  /** The `this` of the call (`undefined` for a plain call). */
  readonly self: unknown
  /** What the call returned (`Success`) or threw (`Failure`). */
  readonly result: Result.Result<Return, unknown>
}

/** A function that records its calls. */
export interface Spy<Args extends ReadonlyArray<unknown> = Array<any>, Return = any> {
  (...args: Args): Return
  /** The calls so far, oldest first. */
  readonly calls: ReadonlyArray<SpyCall<Args, Return>>
  /** The wrapped function. */
  readonly original: (...args: Args) => Return
}

/**
 * Wraps `fn` (by default a function returning `undefined`) in a
 * {@linkcode Spy}. The spy calls through to `fn` with the same `this` and
 * records the outcome; exceptions are recorded and rethrown.
 */
export function spy<Args extends ReadonlyArray<unknown> = Array<any>, Return = undefined>(
  fn?: (...args: Args) => Return,
): Spy<Args, Return> {
  const original = fn ?? ((() => undefined) as unknown as (...args: Args) => Return)
  const calls: Array<SpyCall<Args, Return>> = []
  const wrapper = function(this: unknown, ...args: Args): Return {
    try {
      const returned = original.apply(this, args as unknown as Array<any>)
      calls.push({ args, self: this, result: Result.succeed(returned) })
      return returned
    } catch (error) {
      calls.push({ args, self: this, result: Result.fail(error) })
      throw error
    }
  }
  return Object.assign(wrapper, { calls, original }) as Spy<Args, Return>
}

/** A spy on an effectful function; see {@linkcode spyEffect}. */
export interface EffectSpy<Args extends ReadonlyArray<unknown>, A, E, R> extends Spy<Args, Effect.Effect<A, E, R>> {
  /** How each call's effect ended, by call index; `None` until it has run to the end. */
  readonly exits: ReadonlyArray<Option.Option<Exit.Exit<A, E>>>
}

/**
 * Wraps an effectful function in a spy that also records the `Exit` of each
 * returned effect once it has run, in {@linkcode EffectSpy.exits}.
 */
export function spyEffect<Args extends ReadonlyArray<unknown>, A, E = never, R = never>(
  fn: (...args: Args) => Effect.Effect<A, E, R>,
): EffectSpy<Args, A, E, R> {
  const exits: Array<Option.Option<Exit.Exit<A, E>>> = []
  const inner = spy(function(this: unknown, ...args: Args) {
    const index = exits.push(Option.none()) - 1
    return Effect.onExit(fn.apply(this, args as unknown as Array<any>), (exit) =>
      Effect.sync(() => {
        exits[index] = Option.some(exit)
      }))
  })
  return Object.assign(inner, { exits }) as EffectSpy<Args, A, E, R>
}

/** A stubbed method: a spy that is also the method, until the scope closes. */
export interface Stub<Args extends ReadonlyArray<unknown> = Array<any>, Return = any> extends Spy<Args, Return> {
  /** Whether the original method has been put back. */
  readonly restored: boolean
}

type MethodKeys<T> = { [K in keyof T]: T[K] extends (...args: Array<any>) => any ? K : never }[keyof T]
type MethodArgs<T, K extends keyof T> = T[K] extends (...args: infer A) => any ? A : never
type MethodReturn<T, K extends keyof T> = T[K] extends (...args: Array<any>) => infer R ? R : never

/**
 * Replaces `self[method]` with a spy on `fn` (by default a function returning
 * `undefined`) until the current scope closes, then puts the original back.
 * Fails with a {@linkcode MockError} when the property is not a function or
 * is already a stub.
 */
export const stub = <T extends object, K extends MethodKeys<T>>(
  self: T,
  method: K,
  fn?: (this: T, ...args: MethodArgs<T, K>) => MethodReturn<T, K>,
): Effect.Effect<Stub<MethodArgs<T, K>, MethodReturn<T, K>>, MockError, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.suspend(() => {
      const original = self[method] as unknown
      if (typeof original !== "function") {
        return Effect.fail(new MockError({ message: `Cannot stub: ${String(method)} is not a method` }))
      }
      if (stubs.has(original)) {
        return Effect.fail(new MockError({ message: `Cannot stub: ${String(method)} is already stubbed` }))
      }
      const ownDescriptor = Object.getOwnPropertyDescriptor(self, method)
      if (ownDescriptor && !ownDescriptor.configurable && !ownDescriptor.writable) {
        return Effect.fail(new MockError({ message: `Cannot stub: ${String(method)} is not writable` }))
      }
      const replacement = spy(fn as (...args: MethodArgs<T, K>) => MethodReturn<T, K>)
      let restored = false
      const stubbed = Object.defineProperty(replacement, "restored", { get: () => restored }) as Stub<
        MethodArgs<T, K>,
        MethodReturn<T, K>
      >
      stubs.add(stubbed)
      Object.defineProperty(self, method, { value: stubbed, configurable: true, writable: true, enumerable: ownDescriptor?.enumerable ?? false })
      const restore = () => {
        restored = true
        stubs.delete(stubbed)
        if (ownDescriptor) Object.defineProperty(self, method, ownDescriptor)
        else delete (self as Record<PropertyKey, unknown>)[method as PropertyKey]
      }
      return Effect.succeed({ stubbed, restore })
    }),
    ({ restore }) => Effect.sync(restore),
  ).pipe(Effect.map(({ stubbed }) => stubbed))

const stubs = new WeakSet<object>()

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

const getCall = <Args extends ReadonlyArray<unknown>, Return>(s: Spy<Args, Return>, index: number): SpyCall<Args, Return> => {
  const call = s.calls[index]
  if (call === undefined) throw new AssertionError({ message: `Spy not called as much as expected: ${s.calls.length} call(s)` })
  return call
}

const rethrowAs = (prefix: string, f: () => void): void => {
  try {
    f()
  } catch (error) {
    if (error instanceof AssertionError) {
      throw new AssertionError({ message: `${prefix}:\n${error.message.split("\n").slice(1).join("\n")}` })
    }
    throw error
  }
}

/** Asserts that the spy was called exactly `expected` times. */
export const assertSpyCalls = (s: Spy<any, any>, expected: number): void => {
  if (s.calls.length !== expected) {
    throw new AssertionError({
      message: `Spy called ${s.calls.length < expected ? "fewer" : "more"} times than expected: ${s.calls.length} instead of ${expected}`,
    })
  }
}

/** What {@linkcode assertSpyCall} checks; every field is optional. */
export interface ExpectedSpyCall<Args extends ReadonlyArray<unknown> = Array<any>, Return = any> {
  /** The arguments, compared with `assertEquals`. */
  readonly args?: Args | undefined
  /** The `this` of the call. */
  readonly self?: unknown
  /** The returned value, compared with `assertEquals`. */
  readonly returned?: Return
  /** The thrown error: its class and a part of its message. */
  readonly error?: {
    readonly Class?: (abstract new(...args: Array<any>) => Error) | undefined
    readonly msgIncludes?: string | undefined
  } | undefined
}

/** Asserts how the call at `callIndex` was made and how it ended. */
export const assertSpyCall = <Args extends ReadonlyArray<unknown>, Return>(
  s: Spy<Args, Return>,
  callIndex: number,
  expected?: ExpectedSpyCall<Args, Return>,
): void => {
  const call = getCall(s, callIndex)
  if (!expected) return
  if (expected.args !== undefined) {
    rethrowAs("Spy not called with expected args", () => assertEquals(call.args, expected.args))
  }
  if ("self" in expected) {
    rethrowAs("Spy not called with expected self", () => assertEquals(call.self, expected.self))
  }
  if ("returned" in expected) {
    if (Result.isFailure(call.result)) {
      throw new AssertionError({ message: "Spy call did not return expected value, an error was thrown." })
    }
    const returned = call.result.success
    rethrowAs("Spy call did not return expected value", () => assertEquals(returned, expected.returned))
  }
  if (expected.error !== undefined) {
    if (Result.isSuccess(call.result)) {
      throw new AssertionError({ message: "Spy call did not throw an error, a value was returned." })
    }
    assertIsError(call.result.failure, expected.error.Class, expected.error.msgIncludes)
  }
}

/** Asserts the argument at `argIndex` of the call at `callIndex`, and returns it. */
export const assertSpyCallArg = <Args extends ReadonlyArray<unknown>, Return, A>(
  s: Spy<Args, Return>,
  callIndex: number,
  argIndex: number,
  expected: A,
): A => {
  const call = getCall(s, callIndex)
  rethrowAs("Spy not called with expected arg", () => assertEquals(call.args[argIndex], expected))
  return expected
}

/**
 * Asserts the arguments of the call at `callIndex` from `argsStart` to
 * `argsEnd` (both optional, like `Array.prototype.slice`), and returns them.
 */
export const assertSpyCallArgs = <Args extends ReadonlyArray<unknown>, Return, A extends ReadonlyArray<unknown>>(
  s: Spy<Args, Return>,
  callIndex: number,
  expected: A,
  argsStart?: number,
  argsEnd?: number,
): A => {
  const call = getCall(s, callIndex)
  rethrowAs("Spy not called with expected args", () => assertEquals(call.args.slice(argsStart, argsEnd), expected))
  return expected
}

// ---------------------------------------------------------------------------
// Implementations for spies and stubs
// ---------------------------------------------------------------------------

/** A function that returns its `this`. */
export const returnsThis = <Self>() =>
  function(this: Self): Self {
    return this
  }

/** A function that returns its argument at `index`. */
export const returnsArg = <A>(index: number) => (...args: ReadonlyArray<A>): A | undefined => args[index]

/** A function that returns its arguments from `start` to `end`. */
export const returnsArgs = <Args extends ReadonlyArray<unknown>>(start = 0, end?: number) => (...args: Args): Args =>
  args.slice(start, end) as unknown as Args

/**
 * A function that returns `values` one by one; an `Error` value is thrown
 * instead. Called once more than there are values, it throws a
 * {@linkcode MockError}.
 */
export const returnsNext = <A>(values: Iterable<A | Error>) => {
  const iterator = values[Symbol.iterator]()
  let calls = 0
  return (..._args: ReadonlyArray<unknown>): A => {
    const next = iterator.next()
    if (next.done) throw new MockError({ message: `Not expected to be called more than ${calls} time(s)` })
    calls++
    if (next.value instanceof Error) throw next.value
    return next.value
  }
}

/**
 * The Effect version of std's `resolvesNext`: a function whose effects
 * succeed with `values` one by one; an `Error` value fails the effect
 * instead, and running out fails with a {@linkcode MockError}.
 */
export const succeedsNext = <A, E = Error>(values: Iterable<A | E>, isError: (value: A | E) => value is E = (
  value,
): value is E => value instanceof Error) => {
  const iterator = values[Symbol.iterator]()
  let calls = 0
  return (..._args: ReadonlyArray<unknown>): Effect.Effect<A, E | MockError> =>
    Effect.suspend((): Effect.Effect<A, E | MockError> => {
      const next = iterator.next()
      if (next.done) return Effect.fail(new MockError({ message: `Not expected to be called more than ${calls} time(s)` }))
      calls++
      return isError(next.value) ? Effect.fail(next.value) : Effect.succeed(next.value as A)
    })
}
