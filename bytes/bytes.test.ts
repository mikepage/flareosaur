// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.
import { Array, Option, pipe } from "effect"
import { describe, it } from "../testing/mod.ts"
import { assert, assertEquals, assertFalse, assertNone, assertNotStrictEquals } from "../assert/mod.ts"
import * as Bytes from "./mod.ts"

const b = (...bytes: Array<number>) => new Uint8Array(bytes)
const text = (s: string) => new TextEncoder().encode(s)

describe("concat", () => {
  it("joins byte arrays into a new one", () => {
    const u1 = text("Hello ")
    const u2 = text("World")
    const joined = Bytes.concat([u1, u2])
    assertEquals(new TextDecoder().decode(joined), "Hello World")
    assertNotStrictEquals<Uint8Array>(joined, u1)
  })

  it("handles empty input", () => {
    assertEquals(Bytes.concat([]).byteLength, 0)
    assertEquals(Bytes.concat([b(), b()]).byteLength, 0)
  })
})

describe("copy", () => {
  it("copies into the destination and returns the count", () => {
    const dst = new Uint8Array(4)
    assertEquals(Bytes.copy(b(1, 2), dst), 2)
    assertEquals(dst, b(1, 2, 0, 0))
  })

  it("copies at an offset and truncates what does not fit", () => {
    const dst = new Uint8Array(4)
    assertEquals(Bytes.copy(b(1, 2), dst, 1), 2)
    assertEquals(dst, b(0, 1, 2, 0))
    const small = new Uint8Array(2)
    assertEquals(Bytes.copy(b(3, 4, 5, 6), small), 2)
    assertEquals(small, b(3, 4))
    assertEquals(Bytes.copy(b(1), new Uint8Array(4), 4), 0)
  })
})

describe("startsWith / endsWith", () => {
  it("checks prefixes, data-first and piped", () => {
    assert(Bytes.startsWith(b(0, 1, 2), b(0, 1)))
    assertFalse(Bytes.startsWith(b(0, 1, 2), b(1, 2)))
    assert(pipe(b(0, 1, 2), Bytes.startsWith(b(0))))
  })

  it("checks suffixes, data-first and piped", () => {
    assert(Bytes.endsWith(b(0, 1, 2), b(1, 2)))
    assertFalse(Bytes.endsWith(b(0, 1, 2), b(0, 1)))
    assert(pipe(b(0, 1, 2), Bytes.endsWith(b(2))))
  })
})

describe("equals", () => {
  it("compares bytes", () => {
    assert(Bytes.equals(text("Hello"), text("Hello")))
    assertFalse(Bytes.equals(text("Hello"), text("World")))
    assertFalse(Bytes.equals(b(1, 2), b(1, 2, 3)))
    assert(pipe(b(1), Bytes.equals(b(1))))
  })

  it("is an Equivalence", () => {
    assert(Bytes.Equivalence(b(1, 2), b(1, 2)))
    assertEquals(Array.dedupeWith([b(1), b(1), b(2)], Bytes.Equivalence).length, 2)
  })

  it("handles large arrays", () => {
    const x = new Uint8Array(10_000).map((_, i) => i % 256)
    assert(Bytes.equals(x, x.slice()))
    const y = x.slice()
    y[9_999] = 0
    assertFalse(Bytes.equals(x, y))
  })
})

describe("indexOfNeedle", () => {
  it("finds the first occurrence", () => {
    assertEquals(Bytes.indexOfNeedle(b(1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 3), b(0, 1, 2)), Option.some(2))
    assertEquals(Bytes.indexOfNeedle(b(0, 0, 1), b(0, 1)), Option.some(1))
    assertEquals(Bytes.indexOfNeedle(text("Deno"), text("D")), Option.some(0))
  })

  it("returns None when missing", () => {
    assertNone(Bytes.indexOfNeedle(b(), b(0, 1)))
    assertNone(Bytes.indexOfNeedle(b(0, 1, 2, 0, 1, 2), b(0, 1), 7))
  })

  it("honours start, including negative starts", () => {
    assertEquals(Bytes.indexOfNeedle(b(0, 1, 2, 0, 1, 2), b(0, 1), 1), Option.some(3))
    assertEquals(Bytes.indexOfNeedle(b(0, 1, 2, 0, 1, 2), b(0, 1), -3), Option.some(3))
    assertNone(Bytes.indexOfNeedle(b(0, 1, 2, 1, 1, 2), b(0, 1), -3))
  })

  it("is pipeable", () => {
    assertEquals(pipe(b(0, 1, 2), Bytes.indexOfNeedle(b(2))), Option.some(2))
    assertEquals(pipe(b(2, 1, 2), Bytes.indexOfNeedle(b(2), 1)), Option.some(2))
  })
})

describe("lastIndexOfNeedle", () => {
  it("finds the last occurrence", () => {
    assertEquals(Bytes.lastIndexOfNeedle(b(0, 1, 2, 0, 1, 2, 0, 1, 3), b(0, 1, 2)), Option.some(3))
    assertEquals(Bytes.lastIndexOfNeedle(b(0, 1, 1), b(0, 1)), Option.some(0))
    assertNone(Bytes.lastIndexOfNeedle(b(), b(0, 1)))
  })

  it("honours start", () => {
    assertEquals(Bytes.lastIndexOfNeedle(b(0, 1, 2, 0, 1, 2), b(0, 1), 2), Option.some(0))
    assertNone(Bytes.lastIndexOfNeedle(b(0, 1, 2, 0, 1, 2), b(0, 1), -1))
    assertEquals(pipe(b(0, 1, 2, 0, 1, 2), Bytes.lastIndexOfNeedle(b(0, 1))), Option.some(3))
  })
})

describe("includesNeedle", () => {
  it("checks for an occurrence", () => {
    assert(Bytes.includesNeedle(b(0, 1, 2, 3), b(1, 2)))
    assertFalse(Bytes.includesNeedle(b(0, 1, 2, 3), b(2, 1)))
    assertFalse(Bytes.includesNeedle(b(0, 1, 2, 3), b(1, 2), 2))
    assert(pipe(b(0, 1, 2, 3), Bytes.includesNeedle(b(3))))
  })
})

describe("repeat", () => {
  it("repeats the bytes", () => {
    assertEquals(Bytes.repeat(b(0, 1, 2), 3), b(0, 1, 2, 0, 1, 2, 0, 1, 2))
    assertEquals(Bytes.repeat(b(0, 1, 2), 0), b())
    assertEquals(Bytes.repeat(b(), 3), b())
    assertEquals(pipe(b(7), Bytes.repeat(2)), b(7, 7))
  })

  it("normalizes the count", () => {
    assertEquals(Bytes.repeat(b(1), -1), b())
    assertEquals(Bytes.repeat(b(1), 2.7), b(1, 1))
  })
})
