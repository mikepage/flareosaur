// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.
import { Effect, Fiber, pipe, Ref, Schema } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { describe, it } from "../testing/mod.ts"
import { assertEquals, assertFailsWithTag, assertMatch, assertNotMatch } from "../assert/mod.ts"
import * as RegExps from "./mod.ts"

const ALL_ASCII = Array.from({ length: 128 }, (_, i) => String.fromCharCode(i)).join("")

describe("escape", () => {
  it("escapes pattern characters (Effect's RegExp.escape)", () => {
    assertEquals(RegExps.escape("a*b"), "a\\*b")
    const re = new RegExp(`^${RegExps.escape("1+1=2?")}$`)
    assertMatch("1+1=2?", re)
    assertNotMatch("11=2", re)
  })

  it("escapes inside a character class", () => {
    const re = new RegExp(`^[${RegExps.escape(".$*+[](){}|\\")}]$`)
    for (const c of ".$*+[](){}|\\") assertMatch(c, re)
    assertNotMatch("a", re)
  })
})

describe("escapeStrict", () => {
  it("escapes like std", () => {
    const re = new RegExp(`^${RegExps.escapeStrict(".")}$`, "u")
    assertEquals(re.source, "^\\.$")
    assertMatch(".", re)
    assertEquals(RegExps.escapeStrict("a"), "\\x61")
  })

  it("interpolates every ASCII character in every flag mode", () => {
    for (const char of ALL_ASCII) {
      for (const flag of "gimsuyv") {
        const re = new RegExp(`^${RegExps.escapeStrict(char)}$`, flag)
        assertMatch(char, re)
        new RegExp(`[${RegExps.escapeStrict(char)}]`, flag)
      }
    }
  })

  it("does not extend a preceding escape", () => {
    assertMatch("\0" + "1", new RegExp(`^\\0${RegExps.escapeStrict("1")}$`, "u"))
  })
})

describe("replaceAllEffect", () => {
  it.effect("replaces every match with the replacer's result", () =>
    Effect.gen(function*() {
      const status = (url: string) => Effect.succeed(url.includes("not-found") ? 404 : 200)
      const result = yield* RegExps.replaceAllEffect(
        "https://example.com/ and https://example.com/not-found!",
        /https:\/\/([\w\-/.]+)/g,
        (match, address) => Effect.map(status(match), (s) => `${address} returned status ${s}`),
      )
      assertEquals(result, "example.com/ returned status 200 and example.com/not-found returned status 404!")
    }))

  it.effect("works with a string search value and is pipeable", () =>
    Effect.gen(function*() {
      const result = yield* pipe("a-b-c", RegExps.replaceAllEffect("-", () => Effect.succeed("+")))
      assertEquals(result, "a+b+c")
    }))

  it.effect("passes groups and runs replacers in order by default", () =>
    Effect.gen(function*() {
      const seen = yield* Ref.make<Array<string>>([])
      const result = yield* RegExps.replaceAllEffect("x=1, y=2", /(\w)=(\d)/g, (_, key: string, value: string) =>
        Ref.update(seen, (s) => [...s, key]).pipe(Effect.as(`${value}=${key}`)))
      assertEquals(result, "1=x, 2=y")
      assertEquals(yield* Ref.get(seen), ["x", "y"])
    }))

  it.effect("returns the text unchanged without matches", () =>
    Effect.gen(function*() {
      assertEquals(yield* RegExps.replaceAllEffect("abc", /\d/g, () => Effect.succeed("!")), "abc")
    }))

  it.effect("fails with the replacer's error", () =>
    Effect.gen(function*() {
      class Boom extends Schema.TaggedError<Boom>()("Boom", {}) {}
      const replaced = RegExps.replaceAllEffect("a1", /\d/g, () => Effect.fail(new Boom()))
      yield* assertFailsWithTag(replaced, "Boom")
    }))

  it.effect("runs replacers concurrently when asked", () =>
    Effect.gen(function*() {
      const fiber = yield* Effect.forkChild(
        RegExps.replaceAllEffect("a b c", /\w/g, (c) => Effect.sleep("1 second").pipe(Effect.as(c.toUpperCase())), {
          concurrency: "unbounded",
        }),
      )
      yield* TestClock.adjust("1 second")
      assertEquals(yield* Fiber.join(fiber), "A B C")
    }))
})
