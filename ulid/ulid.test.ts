// Copyright 2026 the flareosaur authors. MIT license.
import { Crypto, DateTime, Effect, Layer, Schema } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { describe, it } from "../testing/mod.ts"
import { assert, assertEquals, assertFailsWithTag, assertFailure, assertFalse, assertSuccess } from "../assert/mod.ts"
import { WebCrypto } from "../crypto/mod.ts"
import * as Ulid from "./mod.ts"

// Random bytes of 30 encode as "Y", like the stubbed encodeRandom of std's tests.
const YCrypto = Layer.succeed(
  Crypto.Crypto,
  Crypto.make({ randomBytes: (size) => new Uint8Array(size).fill(30), digest: () => Effect.die("unused") }),
)

const Monotonic = Ulid.MonotonicUlid.layer.pipe(Layer.provide(YCrypto))

describe("ulid", () => {
  it.effect("encodes the time and 16 random characters", () =>
    Effect.gen(function*() {
      assertEquals(yield* Ulid.ulid({ timestamp: 1469918176385 }), "01ARYZ6S41YYYYYYYYYYYYYYYY")
    }).pipe(Effect.provide(YCrypto)))

  it.effect("takes the time from the Clock", () =>
    Effect.gen(function*() {
      yield* TestClock.setTime(1469918176385)
      const id = yield* Ulid.ulid()
      assertEquals(id.length, 26)
      assertEquals(id.substring(0, 10), "01ARYZ6S41")
      assert(Ulid.isUlid(id))
    }).pipe(Effect.provide(WebCrypto.layer)))

  it.effect("accepts a DateTime", () =>
    Effect.gen(function*() {
      const id = yield* Ulid.ulid({ timestamp: DateTime.makeUnsafe(1469918176385) })
      assertEquals(id.substring(0, 10), "01ARYZ6S41")
    }).pipe(Effect.provide(WebCrypto.layer)))

  it.effect("fails for an invalid time", () =>
    Effect.gen(function*() {
      yield* assertFailsWithTag(Ulid.ulid({ timestamp: -1 }), "UlidError")
      yield* assertFailsWithTag(Ulid.ulid({ timestamp: 2 ** 48 }), "UlidError")
      yield* assertFailsWithTag(Ulid.ulid({ timestamp: 1.5 }), "UlidError")
    }).pipe(Effect.provide(WebCrypto.layer)))
})

describe("monotonicUlid", () => {
  it.effect("increments the random part within a millisecond", () =>
    Effect.gen(function*() {
      yield* TestClock.setTime(1469918176385)
      assertEquals(yield* Ulid.monotonicUlid(), "01ARYZ6S41YYYYYYYYYYYYYYYY")
      assertEquals(yield* Ulid.monotonicUlid(), "01ARYZ6S41YYYYYYYYYYYYYYYZ")
      assertEquals(yield* Ulid.monotonicUlid(), "01ARYZ6S41YYYYYYYYYYYYYYZ0")
      assertEquals(yield* Ulid.monotonicUlid(), "01ARYZ6S41YYYYYYYYYYYYYYZ1")
    }).pipe(Effect.provide(Monotonic)))

  it.effect("keeps the last time when the clock goes backwards", () =>
    Effect.gen(function*() {
      assertEquals(yield* Ulid.monotonicUlid({ timestamp: 1469918176385 }), "01ARYZ6S41YYYYYYYYYYYYYYYY")
      assertEquals(yield* Ulid.monotonicUlid({ timestamp: 1469918176385 }), "01ARYZ6S41YYYYYYYYYYYYYYYZ")
      assertEquals(yield* Ulid.monotonicUlid({ timestamp: 100000000 }), "01ARYZ6S41YYYYYYYYYYYYYYZ0")
      assertEquals(yield* Ulid.monotonicUlid({ timestamp: 10000 }), "01ARYZ6S41YYYYYYYYYYYYYYZ1")
      assertEquals(yield* Ulid.monotonicUlid({ timestamp: 1469918176386 }), "01ARYZ6S42YYYYYYYYYYYYYYYY")
    }).pipe(Effect.provide(Monotonic)))

  it.effect("is strictly increasing with real randomness", () =>
    Effect.gen(function*() {
      const ids: Array<string> = []
      for (let i = 0; i < 100; i++) ids.push(yield* Ulid.monotonicUlid())
      for (let i = 1; i < ids.length; i++) assert(ids[i - 1]! < ids[i]!)
    }).pipe(Effect.provide(Ulid.MonotonicUlid.layer.pipe(Layer.provide(WebCrypto.layer)))))

  it.effect("round-trips the seed time through decodeTime", () =>
    Effect.gen(function*() {
      const id = yield* Ulid.monotonicUlid({ timestamp: 1000 })
      assertEquals(DateTime.toEpochMillis(assertSuccess(Ulid.decodeTime(id))), 1000)
    }).pipe(Effect.provide(Ulid.MonotonicUlid.layer.pipe(Layer.provide(WebCrypto.layer)))))

  it.effect("makeMonotonic gives independent generators", () =>
    Effect.gen(function*() {
      const a = yield* Ulid.makeMonotonic
      const b = yield* Ulid.makeMonotonic
      assertEquals(yield* a({ timestamp: 1469918176385 }), "01ARYZ6S41YYYYYYYYYYYYYYYY")
      assertEquals(yield* a({ timestamp: 1469918176385 }), "01ARYZ6S41YYYYYYYYYYYYYYYZ")
      assertEquals(yield* b({ timestamp: 1469918176385 }), "01ARYZ6S41YYYYYYYYYYYYYYYY")
    }).pipe(Effect.provide(YCrypto)))

  it.effect("fails when the random part overflows", () =>
    Effect.gen(function*() {
      const next = yield* Ulid.makeMonotonic
      yield* next({ timestamp: 1 })
      // 31 is "Z", the largest digit: the first call is all Z, so the next cannot increment.
      const error = yield* assertFailsWithTag(next({ timestamp: 1 }), "UlidError")
      assertEquals(error.message, "Cannot increment this string")
    }).pipe(
      Effect.provide(
        Layer.succeed(
          Crypto.Crypto,
          Crypto.make({ randomBytes: (size) => new Uint8Array(size).fill(31), digest: () => Effect.die("unused") }),
        ),
      ),
    ))
})

describe("decodeTime", () => {
  it("decodes the time as a DateTime", () => {
    const time = assertSuccess(Ulid.decodeTime("01ARYZ6S41TSV4RRFFQ69G5FAV"))
    assertEquals(DateTime.toEpochMillis(time), 1469918176385)
    assertEquals(DateTime.toEpochMillis(assertSuccess(Ulid.decodeTime("01aryz6s41tsv4rrffq69g5fav"))), 1469918176385)
  })

  it("fails on malformed input", () => {
    assertEquals(assertFailure(Ulid.decodeTime("")).message, "ULID must be exactly 26 characters long")
    assertEquals(assertFailure(Ulid.decodeTime("01ARYZ6S41TSV4RRFFQ69G5FAVX")).message, "ULID must be exactly 26 characters long")
    assertEquals(assertFailure(Ulid.decodeTime("0!ARYZ6S41TSV4RRFFQ69G5FAV")).message, "Invalid ULID character found: !")
    assertEquals(
      assertFailure(Ulid.decodeTime("8ZZZZZZZZZTSV4RRFFQ69G5FAV")).message,
      "ULID timestamp component exceeds maximum value of 281474976710655",
    )
  })
})

describe("Ulid schema", () => {
  it.effect("decodes valid ULIDs and rejects others", () =>
    Effect.gen(function*() {
      assertEquals(yield* Schema.decodeUnknownEffect(Ulid.Ulid)("01ARYZ6S41TSV4RRFFQ69G5FAV"), "01ARYZ6S41TSV4RRFFQ69G5FAV")
      yield* assertFailsWithTag(Schema.decodeUnknownEffect(Ulid.Ulid)("01ARYZ6S41TSV4RRFFQ69G5FAU!"), "SchemaError")
      yield* assertFailsWithTag(Schema.decodeUnknownEffect(Ulid.Ulid)("01ARYZ6S41TSV4RRFFQ69G5FI"), "SchemaError")
    }))

  it("isUlid", () => {
    assert(Ulid.isUlid("01ARYZ6S41TSV4RRFFQ69G5FAV"))
    assertFalse(Ulid.isUlid("01ARYZ6S41TSV4RRFFQ69G5FAI"))
    assertFalse(Ulid.isUlid(1))
  })
})
