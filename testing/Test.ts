// Copyright 2026 the flareosaur authors. MIT license.

/**
 * Write tests as Effects. `describe`, `it`, `it.effect` and `it.live` follow
 * the shape of `@effect/vitest`, but register into the flareosaur test
 * runtime, which runs them inside workerd (`npm test`), so tests exercise
 * the code on the same runtime as Cloudflare Workers.
 *
 * `it.effect` provides a `TestClock` and `TestConsole`, so sleeps and
 * timeouts complete as soon as the clock is adjusted. `it.live` runs with the
 * real clock and console. Both run the test in its own `Scope`.
 *
 * ```ts no-assert
 * import { Effect, Fiber } from "effect"
 * import * as TestClock from "effect/testing/TestClock"
 * import { describe, it } from "@mikepage/flareosaur/testing"
 * import { assertEquals } from "@mikepage/flareosaur/assert"
 *
 * describe("timeouts", () => {
 *   it.effect("completes once the clock moves", () =>
 *     Effect.gen(function*() {
 *       const fiber = yield* Effect.forkChild(Effect.sleep("1 minute").pipe(Effect.as("done")))
 *       yield* TestClock.adjust("1 minute")
 *       assertEquals(yield* Fiber.join(fiber), "done")
 *     }))
 * })
 * ```
 *
 * @module
 */

import { Cause, Effect, Exit, Layer, type Scope } from "effect"
// Deep imports: the effect/testing barrel loads TestSchema, which imports
// node:util and so cannot run on Workers without nodejs_compat.
import * as TestClock from "effect/testing/TestClock"
import * as TestConsole from "effect/testing/TestConsole"

const REGISTRY = Symbol.for("flareosaur/testing/registry")

/** A registered test, as the test runtime sees it. */
export interface TestEntry {
  readonly name: string
  readonly skip: boolean
  /** Runs the test; resolves to an error message, or null when it passed. */
  readonly run: () => Promise<string | null>
}

const registry = (): Array<TestEntry> => {
  const global = globalThis as { [REGISTRY]?: Array<TestEntry> }
  return (global[REGISTRY] ??= [])
}

const path: Array<string> = []
const qualified = (name: string): string => [...path, name].join(" > ")

/** The services `it.effect` provides: a test clock and a test console. */
export type TestServices = TestClock.TestClock | TestConsole.TestConsole

const testServices: Layer.Layer<TestServices> = Layer.mergeAll(TestClock.layer(), TestConsole.layer)

const runEffect = async <E>(effect: Effect.Effect<unknown, E, never>): Promise<string | null> => {
  const exit = await Effect.runPromiseExit(effect)
  return Exit.isSuccess(exit) ? null : Cause.pretty(exit.cause)
}

const register = (name: string, run: () => Promise<string | null>, skip = false): void => {
  registry().push({ name: qualified(name), skip, run })
}

/** Groups tests under a name. */
export const describe = (name: string, body: () => void): void => {
  path.push(name)
  try {
    body()
  } finally {
    path.pop()
  }
}

/** A test written as an Effect that needs the test services and a scope. */
export type EffectTest<E = unknown> = () => Effect.Effect<unknown, E, TestServices | Scope.Scope>
/** A test written as an Effect that runs with the live services. */
export type LiveTest<E = unknown> = () => Effect.Effect<unknown, E, Scope.Scope>

export interface Tester {
  /** A plain synchronous or async test. */
  (name: string, fn: () => unknown): void
  /** An Effect test with `TestClock` and `TestConsole`. */
  readonly effect: {
    <E>(name: string, fn: EffectTest<E>): void
    readonly skip: <E>(name: string, fn: EffectTest<E>) => void
    readonly each: <A>(cases: ReadonlyArray<A>) => <E>(name: string, fn: (a: A) => ReturnType<EffectTest<E>>) => void
  }
  /** An Effect test with the real clock and console. */
  readonly live: {
    <E>(name: string, fn: LiveTest<E>): void
    readonly skip: <E>(name: string, fn: LiveTest<E>) => void
  }
  /** Registers a test that is reported as ignored. */
  readonly skip: (name: string, fn: () => unknown) => void
}

const plain = (name: string, fn: () => unknown): void =>
  register(name, () => runEffect(Effect.tryPromise({ try: async () => fn(), catch: (e) => e })))

const effectTest = <E>(name: string, fn: EffectTest<E>): void =>
  register(name, () => runEffect(Effect.suspend(fn).pipe(Effect.scoped, Effect.provide(testServices))))

const liveTest = <E>(name: string, fn: LiveTest<E>): void =>
  register(name, () => runEffect(Effect.suspend(fn).pipe(Effect.scoped)))

const caseName = (name: string, value: unknown, index: number): string =>
  name.replaceAll("%#", String(index)).replaceAll("%s", String(value))

/** Registers tests; see the module documentation. */
export const it: Tester = Object.assign(plain, {
  effect: Object.assign(effectTest, {
    skip: <E>(name: string, _fn: EffectTest<E>) => register(name, async () => null, true),
    each: <A>(cases: ReadonlyArray<A>) => <E>(name: string, fn: (a: A) => ReturnType<EffectTest<E>>) =>
      cases.forEach((value, index) => effectTest(caseName(name, value, index), () => fn(value))),
  }),
  live: Object.assign(liveTest, {
    skip: <E>(name: string, _fn: LiveTest<E>) => register(name, async () => null, true),
  }),
  skip: (name: string, _fn: () => unknown) => register(name, async () => null, true),
})
