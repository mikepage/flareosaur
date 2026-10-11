// Copyright 2026 the flareosaur authors. MIT license.
import { Array, Effect, Equal, Option, pipe, Result, Schema } from "effect"
import { describe, it } from "../testing/mod.ts"
import {
  assert,
  assertEquals,
  assertFailsWithTag,
  assertFailure,
  assertFalse,
  assertNone,
  assertSome,
  assertSuccess,
  assertThrows,
} from "../assert/mod.ts"
import * as SemVer from "./mod.ts"

const v = (s: string) => Result.getOrThrow(SemVer.parse(s))
const r = (s: string) => Result.getOrThrow(SemVer.parseRange(s))

describe("parse", () => {
  it("parses versions into a SemVer", () => {
    const version = assertSuccess(SemVer.parse("1.2.3-beta.1+build.5"))
    assert(version instanceof SemVer.SemVer)
    assertEquals(version.major, 1)
    assertEquals(version.minor, 2)
    assertEquals(version.patch, 3)
    assertEquals(version.prerelease, ["beta", 1])
    assertEquals(version.build, ["build", "5"])
    assertEquals(SemVer.format(assertSuccess(SemVer.parse("  1.2.3  "))), "1.2.3")
  })

  it("fails with a SemVerError on invalid versions", () => {
    for (const input of ["", "1.2", "a.b.c", "1.2.3.4", "01.2.3", "1.2.3-", `1.2.${"9".repeat(300)}`]) {
      const error = assertFailure(SemVer.parse(input), input)
      assertEquals(error._tag, "SemVerError")
      assertEquals(error.kind, "Parse")
      assertEquals(error.input, input)
    }
  })

  it("canParse and isSemVer", () => {
    assert(SemVer.canParse("1.0.0"))
    assertFalse(SemVer.canParse("1.0"))
    assert(SemVer.isSemVer(v("1.0.0")))
    assertFalse(SemVer.isSemVer({ major: 1, minor: 0, patch: 0 }))
  })

  it("make builds and validates versions", () => {
    assertEquals(SemVer.format(SemVer.make({ major: 1, minor: 2, patch: 3, prerelease: ["rc", 1] })), "1.2.3-rc.1")
    assertThrows(() => SemVer.make({ major: -1, minor: 0, patch: 0 }))
    assertThrows(() => SemVer.make({ major: 1.5, minor: 0, patch: 0 }))
  })

  it("toString formats", () => {
    assertEquals(String(v("1.2.3-alpha+001")), "1.2.3-alpha+001")
  })
})

describe("parseRange", () => {
  it("parses npm-style ranges", () => {
    assert(SemVer.isRange(r("^1.2.3")))
    assertEquals(SemVer.formatRange(r(">=1.0.0 <2.0.0")), ">=1.0.0 <2.0.0")
    assertEquals(SemVer.formatRange(r("~1.2.3")), ">=1.2.3 <1.3.0")
    assertEquals(SemVer.formatRange(r("1.x || 3")), ">=1.0.0 <2.0.0||>=3.0.0 <4.0.0")
  })

  it("fails with a SemVerError on invalid ranges", () => {
    const error = assertFailure(SemVer.parseRange("blerg"))
    assertEquals(error.kind, "ParseRange")
    assertFalse(SemVer.isRange("blerg"))
  })
})

describe("Order and Equivalence", () => {
  it("orders by precedence", () => {
    const sorted = Array.sort(
      ["1.0.0", "1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-beta.11", "1.0.0-beta.2", "0.9.9", "2.0.0", "1.0.0-rc.1"].map(v),
      SemVer.Order,
    )
    assertEquals(sorted.map(SemVer.format), [
      "0.9.9",
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-beta.2",
      "1.0.0-beta.11",
      "1.0.0-rc.1",
      "1.0.0",
      "2.0.0",
    ])
  })

  it("ignores build metadata", () => {
    assert(SemVer.Equivalence(v("1.0.0+a"), v("1.0.0+b")))
    assertEquals(SemVer.Order(v("1.0.0+a"), v("1.0.0+b")), 0)
    assert(SemVer.equals(v("1.0.0"), v("1.0.0+b")))
    assertFalse(SemVer.equals(v("1.0.0"), v("1.0.1")))
  })

  it("is structurally equal as data", () => {
    assert(Equal.equals(v("1.2.3"), v("1.2.3")))
  })

  it("comparison helpers are pipeable", () => {
    assert(SemVer.greaterThan(v("2.0.0"), v("1.0.0")))
    assert(pipe(v("2.0.0"), SemVer.greaterThan(v("1.0.0"))))
    assert(SemVer.greaterOrEqual(v("1.0.0"), v("1.0.0")))
    assert(SemVer.lessThan(v("1.0.0-rc.1"), v("1.0.0")))
    assert(SemVer.lessOrEqual(v("1.0.0"), v("1.0.0")))
    assertFalse(SemVer.lessThan(v("1.0.0"), v("1.0.0")))
    assert(pipe(v("1.0.0"), SemVer.equals(v("1.0.0"))))
    assertEquals(SemVer.format(SemVer.max(v("1.0.0"), v("1.1.0"))), "1.1.0")
    assertEquals(SemVer.format(SemVer.min(v("1.0.0"), v("1.1.0"))), "1.0.0")
  })
})

describe("difference", () => {
  it("returns the most significant differing part", () => {
    const cases: ReadonlyArray<[string, string, SemVer.ReleaseType | undefined]> = [
      ["1.2.3", "2.0.0", "major"],
      ["1.2.3", "1.3.0", "minor"],
      ["1.2.3", "1.2.4", "patch"],
      ["1.2.3-pre", "2.0.0", "premajor"],
      ["1.2.3", "1.3.0-pre", "preminor"],
      ["1.2.3-pre.1", "1.2.4", "prepatch"],
      ["1.2.3-pre.1", "1.2.3-pre.2", "prerelease"],
      ["1.2.3", "1.2.3", undefined],
      ["1.2.3+a", "1.2.3+b", undefined],
    ]
    for (const [a, b, expected] of cases) {
      assertEquals(SemVer.difference(v(a), v(b)), Option.fromNullishOr(expected), `${a} ${b}`)
    }
    assertSome(pipe(v("1.0.0"), SemVer.difference(v("2.0.0"))))
  })
})

describe("increment", () => {
  it("increments by release type", () => {
    const cases: ReadonlyArray<[string, SemVer.ReleaseType, SemVer.IncrementOptions | undefined, string]> = [
      ["1.2.3", "major", undefined, "2.0.0"],
      ["1.2.3", "minor", undefined, "1.3.0"],
      ["1.2.3", "patch", undefined, "1.2.4"],
      ["1.2.3-tag", "major", undefined, "2.0.0"],
      ["1.2.3-tag", "patch", undefined, "1.2.3"],
      ["1.2.3", "premajor", undefined, "2.0.0-0"],
      ["1.2.3", "preminor", { prerelease: "beta" }, "1.3.0-beta.0"],
      ["1.2.3", "prepatch", undefined, "1.2.4-0"],
      ["1.2.3-beta.1", "prerelease", undefined, "1.2.3-beta.2"],
      ["1.2.3", "prerelease", undefined, "1.2.4-0"],
      ["1.2.3-alpha.0", "prerelease", { prerelease: "beta" }, "1.2.3-beta.0"],
      ["1.2.3-1", "pre", undefined, "1.2.3-2"],
      ["1.2.3", "minor", { build: "exp.sha.5114f85" }, "1.3.0+exp.sha.5114f85"],
    ]
    for (const [input, release, options, expected] of cases) {
      assertEquals(SemVer.format(assertSuccess(SemVer.increment(v(input), release, options))), expected, input)
    }
  })

  it("is pipeable", () => {
    assertEquals(SemVer.format(assertSuccess(pipe(v("1.2.3"), SemVer.increment("major")))), "2.0.0")
  })

  it("fails with a SemVerError on an invalid release type", () => {
    const error = assertFailure(SemVer.increment(v("1.2.3"), "nope" as SemVer.ReleaseType))
    assertEquals(error.kind, "Increment")
    assertEquals(error.input, "1.2.3")
  })
})

describe("satisfies", () => {
  it("matches std's satisfying cases", () => {
    const cases: ReadonlyArray<[string, string]> = [
      ["1.0.0 - 2.0.0", "1.2.3"],
      ["^1.2.3+build", "1.3.0"],
      ["1.2.3-pre+asdf - 2.4.3-pre+asdf", "1.2.3-pre.2"],
      ["1.0.0", "1.0.0"],
      [">=*", "0.2.4"],
      ["", "1.0.0"],
      ["*", "1.2.3"],
      [">1.0.0", "1.1.0"],
      ["<=2.0.0", "1.9999.9999"],
      ["~1.2.3", "1.2.9"],
      ["1.x", "1.9.0"],
    ]
    for (const [range, version] of cases) assert(SemVer.satisfies(v(version), r(range)), `${version} in ${range}`)
  })

  it("rejects versions outside the range", () => {
    const cases: ReadonlyArray<[string, string]> = [
      ["1.0.0 - 2.0.0", "2.2.3"],
      ["^1.2.3", "2.0.0"],
      ["^1.2.3", "1.2.3-beta"],
      [">1.0.0", "1.0.0"],
      ["~1.2.3", "1.3.0"],
    ]
    for (const [range, version] of cases) assertFalse(SemVer.satisfies(v(version), r(range)), `${version} in ${range}`)
  })

  it("is pipeable", () => {
    assert(pipe(v("1.5.0"), SemVer.satisfies(r("^1.0.0"))))
  })
})

describe("greaterThanRange and lessThanRange", () => {
  it("compare a version with every version of a range", () => {
    assert(SemVer.greaterThanRange(v("2.0.0"), r("~1.2.3")))
    assertFalse(SemVer.greaterThanRange(v("1.2.5"), r("~1.2.3")))
    assert(SemVer.lessThanRange(v("1.2.2"), r("~1.2.3")))
    assertFalse(SemVer.lessThanRange(v("1.2.5"), r("~1.2.3")))
    assert(pipe(v("0.1.0"), SemVer.lessThanRange(r(">=1.0.0"))))
    assert(pipe(v("3.0.0"), SemVer.greaterThanRange(r("<2.0.0"))))
  })
})

describe("maxSatisfying and minSatisfying", () => {
  it("find the highest and lowest satisfying versions", () => {
    const versions = ["1.2.3", "1.2.4", "1.2.5", "1.2.6", "2.0.0"].map(v)
    assertEquals(SemVer.format(assertSome(SemVer.maxSatisfying(versions, r("~1.2.3")))), "1.2.6")
    assertEquals(SemVer.format(assertSome(SemVer.minSatisfying(versions, r("~1.2.3")))), "1.2.3")
    assertEquals(SemVer.format(assertSome(SemVer.maxSatisfying(versions.toReversed(), r("1.2")))), "1.2.6")
    assertNone(SemVer.maxSatisfying(versions, r(">3.0.0")))
    assertNone(SemVer.minSatisfying([], r("*")))
  })

  it("are pipeable", () => {
    assertEquals(
      SemVer.format(assertSome(pipe(["1.1.0", "1.9.0"].map(v), SemVer.maxSatisfying(r("^1.0.0"))))),
      "1.9.0",
    )
    assertEquals(
      SemVer.format(assertSome(pipe(["1.1.0", "1.9.0"].map(v), SemVer.minSatisfying(r("^1.0.0"))))),
      "1.1.0",
    )
  })
})

describe("rangeIntersects", () => {
  it("matches std's cases", () => {
    const cases: ReadonlyArray<[string, string, boolean]> = [
      ["1.3.0 || <1.0.0 >2.0.0", "1.3.0 || <1.0.0 >2.0.0", true],
      [">0.0.0", "<1.0.0 >2.0.0", false],
      ["<1.0.0 >2.0.0", ">1.4.0 <1.6.0", false],
      [">1.0.0 <=2.0.0", "2.0.0", true],
      ["<1.0.0 >=2.0.0", "2.1.0", false],
      ["1.5.x", "<1.5.0 || >=1.6.0", false],
      [">=1.0.0", "<=1.0.0", true],
      ["^1.0.0", "^2.0.0", false],
    ]
    for (const [a, b, expected] of cases) assertEquals(SemVer.rangeIntersects(r(a), r(b)), expected, `${a} / ${b}`)
    assert(pipe(r("^1.0.0"), SemVer.rangeIntersects(r(">=1.5.0"))))
  })
})

describe("SemVerFromString", () => {
  it.effect("decodes and encodes version strings", () =>
    Effect.gen(function*() {
      const Manifest = Schema.Struct({ version: SemVer.SemVerFromString })
      const manifest = yield* Schema.decodeUnknownEffect(Manifest)({ version: "1.2.3-rc.1+b" })
      assert(manifest.version instanceof SemVer.SemVer)
      assertEquals(manifest.version.prerelease, ["rc", 1])
      assertEquals(yield* Schema.encodeEffect(Manifest)(manifest), { version: "1.2.3-rc.1+b" })
      yield* assertFailsWithTag(Schema.decodeUnknownEffect(Manifest)({ version: "1.2" }), "SchemaError")
    }))

  it.effect("decodes a SemVer Schema class from its parts", () =>
    Effect.gen(function*() {
      const version = yield* Schema.decodeUnknownEffect(SemVer.SemVer)({
        major: 1,
        minor: 0,
        patch: 0,
        prerelease: [],
        build: [],
      })
      assertEquals(SemVer.format(version), "1.0.0")
      yield* assertFailsWithTag(
        Schema.decodeUnknownEffect(SemVer.SemVer)({ major: -1, minor: 0, patch: 0, prerelease: [], build: [] }),
        "SchemaError",
      )
    }))
})
