// Copyright 2026 the flareosaur authors. MIT license.
import { Crypto, DateTime, Effect, Layer, Option, Result, Schema } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { describe, it } from "../testing/mod.ts"
import {
  assert,
  assertEquals,
  assertFailsWithTag,
  assertFailure,
  assertFalse,
  assertMatch,
  assertNone,
  assertNotEquals,
  assertSome,
  assertSuccess,
} from "../assert/mod.ts"
import { WebCrypto } from "../crypto/mod.ts"
import * as Uuid from "./mod.ts"

// A Crypto service whose random bytes repeat `pattern`, for known-answer tests.
const fixedCrypto = (pattern: ReadonlyArray<number>) =>
  Layer.succeed(
    Crypto.Crypto,
    Crypto.make({
      randomBytes: (size) => Uint8Array.from({ length: size }, (_, i) => pattern[i % pattern.length]!),
      digest: () => Effect.die("unused"),
    }),
  )

const NAMESPACE = "1b671a64-40d5-491e-99b0-da01ff1f3341"

describe("validation", () => {
  it("isUuid accepts every version, nil and max", () => {
    assert(Uuid.isUuid("63655efa-7ee6-11ea-bc55-0242ac130003"))
    assert(Uuid.isUuid("6ec0bd7f-11c0-43da-975e-2a8ad9ebae0b"))
    assert(Uuid.isUuid("6EC0BD7F-11C0-43DA-975E-2A8AD9EBAE0B"))
    assert(Uuid.isUuid(Uuid.NIL))
    assert(Uuid.isUuid(Uuid.MAX))
    assertFalse(Uuid.isUuid("63655efa-7ee6-11eg-bc55-0242ac130003"))
    assertFalse(Uuid.isUuid("6ec0bd7f-11c0-43da-c75e-2a8ad9ebae0b"))
    assertFalse(Uuid.isUuid("not a uuid"))
    assertFalse(Uuid.isUuid(42))
  })

  it("isNil and isMax", () => {
    assert(Uuid.isNil("00000000-0000-0000-0000-000000000000"))
    assertFalse(Uuid.isNil("6ec0bd7f-11c0-43da-975e-2a8ad9ebae0b"))
    assert(Uuid.isMax("FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF"))
    assertFalse(Uuid.isMax(Uuid.NIL))
  })

  it("version detects the version", () => {
    assertEquals(assertSome(Uuid.version("63655efa-7ee6-11ea-bc55-0242ac130003")), 1)
    assertEquals(assertSome(Uuid.version("6ec0bd7f-11c0-43da-975e-2a8ad9ebae0b")), 4)
    assertEquals(assertSome(Uuid.version("017f22e2-79b0-7cc3-98c4-dc0c0c07398f")), 7)
    assertNone(Uuid.version(Uuid.NIL))
    assertNone(Uuid.version(Uuid.MAX))
    assertNone(Uuid.version("invalid"))
  })

  it("constants", () => {
    assertEquals(Uuid.NAMESPACE_DNS, "6ba7b810-9dad-11d1-80b4-00c04fd430c8")
    assertEquals(Uuid.NAMESPACE_URL, "6ba7b811-9dad-11d1-80b4-00c04fd430c8")
    assertEquals(Uuid.NAMESPACE_OID, "6ba7b812-9dad-11d1-80b4-00c04fd430c8")
    assertEquals(Uuid.NAMESPACE_X500, "6ba7b814-9dad-11d1-80b4-00c04fd430c8")
  })

  it("toBytes and fromBytes round-trip", () => {
    const bytes = assertSuccess(Uuid.toBytes("6ba7b810-9dad-11d1-80b4-00c04fd430c8"))
    assertEquals(bytes.length, 16)
    assertEquals(bytes[0], 0x6b)
    assertEquals(bytes[15], 0xc8)
    assertEquals(assertSuccess(Uuid.fromBytes(bytes)), "6ba7b810-9dad-11d1-80b4-00c04fd430c8")
    assertFailure(Uuid.toBytes("nope"))
    assertFailure(Uuid.fromBytes(new Uint8Array(15)))
  })
})

describe("Schema", () => {
  it.effect("Uuid decodes valid UUIDs and rejects others", () =>
    Effect.gen(function*() {
      assertEquals(yield* Schema.decodeUnknownEffect(Uuid.Uuid)(Uuid.NIL), Uuid.NIL)
      yield* assertFailsWithTag(Schema.decodeUnknownEffect(Uuid.Uuid)("nope"), "SchemaError")
    }))

  it.effect("per-version schemas check the version", () =>
    Effect.gen(function*() {
      const v4 = "6ec0bd7f-11c0-43da-975e-2a8ad9ebae0b"
      assertEquals(yield* Schema.decodeUnknownEffect(Uuid.UuidV4)(v4), v4)
      yield* assertFailsWithTag(Schema.decodeUnknownEffect(Uuid.UuidV7)(v4), "SchemaError")
      yield* assertFailsWithTag(Schema.decodeUnknownEffect(Uuid.UuidV1)(Uuid.NIL), "SchemaError")
      assert(Schema.is(Uuid.UuidV3)("71d7129f-e809-30ed-a2c6-ea9032b43c0d"))
      assert(Schema.is(Uuid.UuidV5)("4b4f2adc-5b27-57b5-8e3a-c4c4bcf94f05"))
      assert(Schema.is(Uuid.UuidV6)("1e1122bd-9428-6892-b85c-0123456789ab"))
      assert(Schema.is(Uuid.schemaVersion(8))("320c3d4d-cc00-875b-8ec9-32d5f69181c0"))
    }))
})

describe("v1", () => {
  it.effect("generates a static UUID from explicit options", () =>
    Effect.gen(function*() {
      const u = yield* Uuid.v1({
        node: [0x01, 0x23, 0x45, 0x67, 0x89, 0xab],
        clockseq: 0x1234,
        timestamp: new Date("2011-11-01").getTime(),
        nsecs: 5678,
      })
      assertEquals(u, "710b962e-041c-11e1-9234-0123456789ab")
    }).pipe(Effect.provide(fixedCrypto([0]))))

  it.effect("takes the node and clock sequence from Crypto and time from the Clock", () =>
    Effect.gen(function*() {
      yield* TestClock.setTime(new Date("2011-11-01").getTime())
      const u = yield* Uuid.v1()
      assert(u.endsWith("9111-0123456789ab"))
      assertEquals(assertSuccess(Uuid.extractTimestamp(u)), DateTime.makeUnsafe("2011-11-01T00:00:00Z"))
      assert(Schema.is(Uuid.UuidV1)(u))
    }).pipe(Effect.provide(fixedCrypto([0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0x11, 0x11]))))

  it.effect("fails for a bad node or too many UUIDs per tick", () =>
    Effect.gen(function*() {
      const short = yield* assertFailsWithTag(Uuid.v1({ node: [1, 2, 3, 4, 5] }), "UuidError")
      assertEquals(short.message, "Cannot create UUID: the node option must be an array of 6 bytes")
      const fast = yield* assertFailsWithTag(Uuid.v1({ nsecs: 10001 }), "UuidError")
      assertEquals(fast.message, "Cannot create more than 10M uuids/sec")
    }).pipe(Effect.provide(WebCrypto.layer)))
})

describe("v6", () => {
  it.effect("generates a static UUID from explicit options", () =>
    Effect.gen(function*() {
      const u = yield* Uuid.v6({
        node: [0x01, 0x23, 0x45, 0x67, 0x89, 0xab],
        clockseq: 0x385c,
        timestamp: DateTime.makeUnsafe("2011-11-18T21:25:33.573Z"),
        nsecs: 5442,
      })
      assertEquals(u, "1e1122bd-9428-6892-b85c-0123456789ab")
    }).pipe(Effect.provide(fixedCrypto([0]))))

  it.effect("uses random bytes from Crypto", () =>
    Effect.gen(function*() {
      const u = yield* Uuid.v6({ timestamp: new Date("2011-11-18T21:25:33.573Z").getTime(), nsecs: 5442 })
      assertEquals(u, "1e1122bd-9428-6892-adef-0123456789ab")
      assertEquals(
        DateTime.formatIso(assertSuccess(Uuid.extractTimestamp(u))),
        "2011-11-18T21:25:33.573Z",
      )
    }).pipe(Effect.provide(fixedCrypto([0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0x2d, 0xef]))))

  it.effect("fails for a bad node", () =>
    Effect.gen(function*() {
      yield* assertFailsWithTag(Uuid.v6({ node: [1, 2, 3, 4, 5, 6, 7] }), "UuidError")
    }).pipe(Effect.provide(WebCrypto.layer)))
})

describe("v3 and v5", () => {
  it.effect("v3 hashes with MD5", () =>
    Effect.gen(function*() {
      assertEquals(yield* Uuid.v3(NAMESPACE, "Hello, World"), "71d7129f-e809-30ed-a2c6-ea9032b43c0d")
      assertEquals(
        yield* Uuid.v3(NAMESPACE, new TextEncoder().encode("Hello, World")),
        "71d7129f-e809-30ed-a2c6-ea9032b43c0d",
      )
      // Python's uuid.uuid3(uuid.NAMESPACE_DNS, "python.org")
      assertEquals(yield* Uuid.v3(Uuid.NAMESPACE_DNS, "python.org"), "6fa459ea-ee8a-3ca4-894e-db77e160355e")
    }))

  it.effect("v5 hashes with SHA-1", () =>
    Effect.gen(function*() {
      assertEquals(yield* Uuid.v5(NAMESPACE, "Hello, World"), "4b4f2adc-5b27-57b5-8e3a-c4c4bcf94f05")
      // Python's uuid.uuid5(uuid.NAMESPACE_DNS, "python.org")
      assertEquals(yield* Uuid.v5(Uuid.NAMESPACE_DNS, "python.org"), "886313e1-3b8a-5372-9b90-0c9aee199e5d")
    }))

  it.effect("fail on an invalid namespace", () =>
    Effect.gen(function*() {
      yield* assertFailsWithTag(Uuid.v3("invalid-uuid", ""), "UuidError")
      yield* assertFailsWithTag(Uuid.v5("1b671a64-40d5-491e-99b0-da01ff1f334Z", ""), "UuidError")
    }))
})

describe("v4", () => {
  it.effect("generates random v4 UUIDs", () =>
    Effect.gen(function*() {
      const a = yield* Uuid.v4
      const b = yield* Uuid.v4
      assert(Schema.is(Uuid.UuidV4)(a))
      assertNotEquals(a, b)
    }).pipe(Effect.provide(WebCrypto.layer)))
})

describe("v7", () => {
  it.effect("matches the RFC 9562 example vector", () =>
    Effect.gen(function*() {
      const u = yield* Uuid.v7({ timestamp: 0x017F22E279B0 })
      assertEquals(u, "017f22e2-79b0-7cc3-98c4-dc0c0c07398f")
    }).pipe(Effect.provide(fixedCrypto([0, 0, 0, 0, 0, 0, 0x0C, 0xC3, 0x18, 0xC4, 0xDC, 0x0C, 0x0C, 0x07, 0x39, 0x8F]))))

  it.effect("takes the time from the Clock", () =>
    Effect.gen(function*() {
      yield* TestClock.setTime(1645557742000)
      const u = yield* Uuid.v7()
      assertMatch(u, /^017f22e2-79b0-7/)
      assertEquals(DateTime.toEpochMillis(assertSuccess(Uuid.extractTimestamp(u))), 1645557742000)
    }).pipe(Effect.provide(WebCrypto.layer)))

  it.effect("sorts by time", () =>
    Effect.gen(function*() {
      const a = yield* Uuid.v7({ timestamp: 1000 })
      const b = yield* Uuid.v7({ timestamp: 2000 })
      assert(a < b)
    }).pipe(Effect.provide(WebCrypto.layer)))

  it.effect("fails for an out-of-range timestamp", () =>
    Effect.gen(function*() {
      yield* assertFailsWithTag(Uuid.v7({ timestamp: -1 }), "UuidError")
      yield* assertFailsWithTag(Uuid.v7({ timestamp: 2 ** 48 }), "UuidError")
      yield* assertFailsWithTag(Uuid.v7({ timestamp: 1.5 }), "UuidError")
    }).pipe(Effect.provide(WebCrypto.layer)))
})

describe("extractTimestamp", () => {
  it("reads v7 timestamps", () => {
    const t = assertSuccess(Uuid.extractTimestamp("017f22e2-79b0-7cc3-98c4-dc0c0c07398f"))
    assertEquals(DateTime.toEpochMillis(t), 1645557742000)
  })

  it("reads v1 timestamps", () => {
    const t = assertSuccess(Uuid.extractTimestamp("710b962e-041c-11e1-9234-0123456789ab"))
    assertEquals(DateTime.formatIso(t), "2011-11-01T00:00:00.000Z")
  })

  it("fails for other versions and invalid input", () => {
    assertFailure(Uuid.extractTimestamp("6ec0bd7f-11c0-43da-975e-2a8ad9ebae0b"))
    assertFailure(Uuid.extractTimestamp("invalid-uuid"))
    assert(Result.isFailure(Uuid.extractTimestamp(Uuid.NIL)))
    assert(Option.isNone(Uuid.version(Uuid.NIL)))
  })
})
