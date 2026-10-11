// Copyright 2026 the flareosaur authors. MIT license.
import { Data, Effect, Option, Redacted, Result } from "effect"
import { describe, it } from "../testing/mod.ts"
import {
  AssertionError,
  assertDies,
  assertEquals,
  assertFails,
  assertFailsWithTag,
  assertNone,
  assertNotEquals,
  assertSome,
  assertSucceeds,
  assertSuccess,
  assertThrows,
} from "./mod.ts"
import { format } from "../internal/mod.ts"

class Point extends Data.Class<{ x: number; y: number }> {}
class NotFound extends Data.TaggedError("NotFound")<{ id: string }> {}

describe("assertEquals", () => {
  it("compares structurally", () => {
    assertEquals({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })
    assertNotEquals({ a: 1 }, { a: 2 })
  })

  it("uses Equal for Effect data types", () => {
    assertEquals(new Point({ x: 1, y: 2 }), new Point({ x: 1, y: 2 }))
    assertEquals(Option.some([1, 2]), Option.some([1, 2]))
    assertNotEquals(Option.some(1), Option.none())
  })

  it("throws an AssertionError with a Deno-style diff", () => {
    const error = assertThrows(() => assertEquals({ a: 1 }, { a: 2 }), AssertionError)
    assertEquals(error._tag, "AssertionError")
    assertEquals(error.message.includes("a: 1,"), true)
  })
})

describe("Option and Result", () => {
  it("unwraps Some and Success", () => {
    assertEquals(assertSome(Option.some(3)), 3)
    assertNone(Option.none())
    assertEquals(assertSuccess(Result.succeed("ok")), "ok")
  })
})

describe("effect assertions", () => {
  it.effect("returns the value of a successful effect", () =>
    Effect.gen(function*() {
      assertEquals(yield* assertSucceeds(Effect.succeed(1)), 1)
    }))

  it.effect("returns the error of a failed effect", () =>
    Effect.gen(function*() {
      const error = yield* assertFailsWithTag(Effect.fail(new NotFound({ id: "x" })), "NotFound")
      assertEquals(error.id, "x")
      assertEquals(yield* assertFails(Effect.fail("boom")), "boom")
    }))

  it.effect("fails when the effect does not end as expected", () =>
    Effect.gen(function*() {
      const error = yield* assertFails(assertSucceeds(Effect.fail("boom")))
      assertEquals(error._tag, "AssertionError")
      assertEquals(error.message.includes("boom"), true)
      yield* assertDies(Effect.die("defect"))
    }))
})

describe("format", () => {
  it("redacts secrets", () => {
    assertEquals(format({ token: Redacted.make("hunter2") }).includes("hunter2"), false)
  })
})
