// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.
import { Effect, Exit, Option, Result } from "effect"
import { describe, it } from "./mod.ts"
import { assert, assertEquals, assertFailsWithTag, assertFalse, assertThrows, AssertionError } from "../assert/mod.ts"
import {
  assertSpyCall,
  assertSpyCallArg,
  assertSpyCallArgs,
  assertSpyCalls,
  MockError,
  returnsArg,
  returnsArgs,
  returnsNext,
  returnsThis,
  spy,
  spyEffect,
  stub,
  succeedsNext,
} from "./Mock.ts"

class Point {
  constructor(public x: number, public y: number) {}
  action(...args: Array<unknown>): unknown {
    return args[0]
  }
  explode(): never {
    throw new Error("boom")
  }
}

describe("spy", () => {
  it("records calls, arguments, this and results", () => {
    const add = spy((a: number, b: number) => a + b)
    assertSpyCalls(add, 0)
    assertEquals(add(1, 2), 3)
    assertEquals(add.call("self", 3, 4), 7)
    assertSpyCalls(add, 2)
    assertEquals(add.calls[0]!.args, [1, 2])
    assertEquals(add.calls[0]!.result, Result.succeed(3))
    assertEquals(add.calls[1]!.self, "self")
    assertSpyCall(add, 0, { args: [1, 2], returned: 3 })
    assertSpyCall(add, 1, { self: "self", args: [3, 4] })
  })

  it("records and rethrows exceptions", () => {
    const fail = spy((): number => {
      throw new TypeError("nope")
    })
    assertThrows(() => fail(), TypeError, "nope")
    assert(Result.isFailure(fail.calls[0]!.result))
    assertSpyCall(fail, 0, { error: { Class: TypeError, msgIncludes: "nope" } })
    assertThrows(() => assertSpyCall(fail, 0, { returned: 1 }), AssertionError, "an error was thrown")
  })

  it("defaults to a function returning undefined", () => {
    const noop = spy()
    assertEquals(noop(), undefined)
    assertSpyCall(noop, 0, { args: [], returned: undefined })
  })

  it("assertion failures are AssertionErrors", () => {
    const f = spy((n: number) => n)
    f(1)
    assertThrows(() => assertSpyCalls(f, 2), AssertionError, "fewer times than expected")
    assertThrows(() => assertSpyCall(f, 1), AssertionError, "not called as much as expected")
    assertThrows(() => assertSpyCall(f, 0, { args: [2] }), AssertionError, "Spy not called with expected args")
    assertThrows(() => assertSpyCall(f, 0, { returned: 2 }), AssertionError, "did not return expected value")
    assertThrows(() => assertSpyCall(f, 0, { error: {} }), AssertionError, "a value was returned")
  })

  it("asserts single and sliced arguments", () => {
    const f = spy((..._args: Array<number>) => undefined)
    f(1, 2, 3)
    assertEquals(assertSpyCallArg(f, 0, 1, 2), 2)
    assertEquals(assertSpyCallArgs(f, 0, [1, 2, 3]), [1, 2, 3])
    assertEquals(assertSpyCallArgs(f, 0, [2, 3], 1), [2, 3])
    assertEquals(assertSpyCallArgs(f, 0, [2], 1, 2), [2])
    assertThrows(() => assertSpyCallArg(f, 0, 0, 9), AssertionError, "expected arg")
  })
})

describe("spyEffect", () => {
  it.effect("records the exit of each effect once it has run", () =>
    Effect.gen(function*() {
      const half = spyEffect((n: number) => n % 2 === 0 ? Effect.succeed(n / 2) : Effect.fail(new MockError({ message: "odd" })))
      const pending = half(4)
      assertEquals(half.exits, [Option.none()])
      assertEquals(yield* pending, 2)
      yield* Effect.exit(half(3))
      assertSpyCalls(half, 2)
      assertEquals(half.exits[0], Option.some(Exit.succeed(2)))
      assert(Option.isSome(half.exits[1]!) && Exit.isFailure(half.exits[1].value))
    }))
})

describe("stub", () => {
  it.effect("replaces a method for the scope and restores it", () =>
    Effect.gen(function*() {
      const point = new Point(2, 3)
      const original = point.action
      const action = yield* Effect.scoped(
        Effect.gen(function*() {
          const action = yield* stub(point, "action", () => "stubbed")
          assertEquals(point.action(1, 2), "stubbed")
          assertSpyCall(action, 0, { self: point, args: [1, 2], returned: "stubbed" })
          assertFalse(action.restored)
          return action
        }),
      )
      assert(action.restored)
      assertEquals(point.action, original)
      assertEquals(point.action(5), 5)
      assertFalse(Object.hasOwn(point, "action"))
    }))

  it.effect("defaults to a function returning undefined", () =>
    Effect.gen(function*() {
      const point = new Point(2, 3)
      const action = yield* stub(point, "action")
      assertEquals(point.action(1), undefined)
      assertSpyCalls(action, 1)
    }))

  it.effect("restores own properties", () =>
    Effect.gen(function*() {
      const obj = { greet: (name: string) => `hello ${name}` }
      yield* Effect.scoped(
        stub(obj, "greet", (name) => `hi ${name}`).pipe(
          Effect.tap(() => Effect.sync(() => assertEquals(obj.greet("a"), "hi a"))),
        ),
      )
      assertEquals(obj.greet("a"), "hello a")
    }))

  it.effect("fails on non-methods and double stubs", () =>
    Effect.gen(function*() {
      const point = new Point(2, 3)
      yield* assertFailsWithTag(stub(point as any, "x"), "MockError")
      yield* stub(point, "action")
      yield* assertFailsWithTag(stub(point, "action"), "MockError")
    }))

  it.effect("is restored at the end of the test scope", () =>
    Effect.gen(function*() {
      const point = new Point(1, 1)
      const explode = yield* stub(point, "explode", () => {
        throw new RangeError("stubbed")
      })
      assertThrows(() => point.explode(), RangeError)
      assertSpyCall(explode, 0, { error: { Class: RangeError } })
    }))
})

describe("implementations", () => {
  it("returnsThis, returnsArg, returnsArgs", () => {
    const self = { f: returnsThis<object>() }
    assertEquals(self.f(), self)
    assertEquals(returnsArg<number>(1)(1, 2, 3), 2)
    assertEquals(returnsArg<number>(5)(1), undefined)
    assertEquals(returnsArgs<Array<number>>(1)(1, 2, 3), [2, 3])
    assertEquals(returnsArgs<Array<number>>(0, 1)(1, 2, 3), [1])
  })

  it("returnsNext returns, throws, then runs out", () => {
    const next = returnsNext<number>([1, new Error("two"), 3])
    assertEquals(next(), 1)
    assertThrows(() => next(), Error, "two")
    assertEquals(next(), 3)
    assertThrows(() => next(), MockError, "Not expected to be called more than 3 time(s)")
  })

  it.effect("succeedsNext succeeds, fails, then runs out", () =>
    Effect.gen(function*() {
      const next = succeedsNext<number>([1, new Error("two")])
      assertEquals(yield* next(), 1)
      const error = yield* Effect.flip(next())
      assertEquals((error as Error).message, "two")
      yield* assertFailsWithTag(next(), "MockError")
    }))
})
