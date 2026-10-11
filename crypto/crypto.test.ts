// Copyright 2026 the flareosaur authors. MIT license.
import { Crypto as EffectCrypto, Effect, Layer, Redacted, Result, Stream } from "effect"
import * as Hex from "effect/encoding/Hex"
import { describe, it } from "../testing/mod.ts"
import { assert, assertEquals, assertFailsWithTag, assertFalse, assertNotEquals } from "../assert/mod.ts"
import * as Crypto from "./mod.ts"

const hex = (s: string) => Result.getOrThrow(Hex.decode(s))

// A Crypto service whose random bytes are all zero, for known-answer tests.
const ZeroCrypto = Layer.succeed(
  EffectCrypto.Crypto,
  EffectCrypto.make({ randomBytes: (size) => new Uint8Array(size), digest: () => Effect.die("unused") }),
)

// Digests of the empty input, from std's crypto_test.ts.
const EMPTY: Record<Crypto.DigestAlgorithm, string> = {
  BLAKE2B:
    "786a02f742015903c6c6fd852552d272912f4740e15847618a86e217f71f5419d25e1031afee585313896444934eb04b903a685b1448b755d56f701afe9be2ce",
  "BLAKE2B-128": "cae66941d9efbd404e4d88758ea67670",
  "BLAKE2B-160": "3345524abf6bbe1809449224b5972c41790b6cf2",
  "BLAKE2B-224": "836cc68931c2e4e3e838602eca1902591d216837bafddfe6f0c8cb07",
  "BLAKE2B-256": "0e5751c026e543b2e8ab2eb06099daa1d1e5df47778f7787faab45cdf12fe3a8",
  "BLAKE2B-384":
    "b32811423377f52d7862286ee1a72ee540524380fda1724a6f25d7978c6fd3244a6caf0498812673c5e05ef583825100",
  BLAKE2S: "69217a3079908094e11121d042354a7c1f55b6482ca1a51e1b250dfd1ed0eef9",
  BLAKE3: "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262",
  "KECCAK-224": "f71837502ba8e10837bdd8d365adb85591895602fc552b48b7390abd",
  "KECCAK-256": "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
  "KECCAK-384":
    "2c23146a63a29acf99e73b88f8c24eaa7dc60aa771780ccc006afbfa8fe2479b2dd2b21362337441ac12b515911957ff",
  "KECCAK-512":
    "0eab42de4c3ceb9235fc91acffe746b29c29a8c366b7c60e4e67c466f36a4304c00fa9caf9d87976ba469bcbe06713b435f091ef2769fb160cdab33d3670680e",
  MD4: "31d6cfe0d16ae931b73c59d7e0c089c0",
  MD5: "d41d8cd98f00b204e9800998ecf8427e",
  "RIPEMD-160": "9c1185a5c5e9fc54612808977ee8f548b2258d31",
  "SHA-1": "da39a3ee5e6b4b0d3255bfef95601890afd80709",
  "SHA-224": "d14a028c2a3a2bc9476102bb288234c415a2b01f828ea62ac5b3e42f",
  "SHA-256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "SHA3-224": "6b4e03423667dbb73b6e15454f0eb1abd4597f9a1b078e3f5b5a6bc7",
  "SHA3-256": "a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a",
  "SHA3-384":
    "0c63a75b845e4f7d01107d852e4c2485c51a50aaaa94fc61995e71bbee983a2ac3713831264adb47fb6bd1e058d5f004",
  "SHA3-512":
    "a69f73cca23a9ac5c8b567dc185a756e97c982164fe25859e0d1dcc1475c80a615b2123af1f5f94c11e3e9402c3ac558f500199d95b6d3e301758586281dcd26",
  "SHA-384":
    "38b060a751ac96384cd9327eb1b1e36a21fdb71114be07434c0cc7bf63f6e1da274edebfe76f65fbd51ad2f14898b95b",
  "SHA-512":
    "cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e",
  SHAKE128: "7f9c2ba4e88f827d616045507605853ed73b8093f6efbc88eb1a6eacfa66ef26",
  SHAKE256:
    "46b9dd2b0ba88d13233b3feb743eeb243fcd52ea62b81b82b50c27646ed5762fd75dc4ddd8c0f200cb05019d67b592f6fc821c49479ab48640292eacb3b7c4be",
  TIGER: "3293ac630c13f0245f92bbb1766e16167a4e58492dde73f3",
  FNV32: "811c9dc5",
  FNV32A: "811c9dc5",
  FNV64: "cbf29ce484222325",
  FNV64A: "cbf29ce484222325",
}

describe("digest", () => {
  it.effect("hashes BLAKE3 with the Wasm hasher", () =>
    Effect.gen(function*() {
      assertEquals(
        Hex.encode(yield* Crypto.digest("abc", "BLAKE3")),
        "6437b3ac38465133ffb63b75273a8db548c558465d79db03fd359c6cd5bd9d85",
      )
    }))

  it.effect("hashes SHA-256 with Web Crypto", () =>
    Effect.gen(function*() {
      assertEquals(
        Hex.encode(yield* Crypto.digest(new TextEncoder().encode("abc"), "SHA-256")),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      )
    }))

  it.effect("matches std's vectors for the empty input, for every algorithm", () =>
    Effect.gen(function*() {
      for (const algorithm of Crypto.DIGEST_ALGORITHMS) {
        assertEquals(Hex.encode(yield* Crypto.digest(new Uint8Array(), algorithm)), EMPTY[algorithm], algorithm)
      }
    }))

  it.effect("is pipeable and case-insensitive", () =>
    Effect.gen(function*() {
      const hash = yield* Effect.succeed("").pipe(Effect.flatMap(Crypto.digest("md5" as Crypto.DigestAlgorithm)))
      assertEquals(Hex.encode(hash), EMPTY.MD5)
    }))

  it.effect("supports an output length for extendable algorithms", () =>
    Effect.gen(function*() {
      assertEquals((yield* Crypto.digest("abc", "BLAKE3", { length: 64 })).length, 64)
      assertEquals((yield* Crypto.digest("abc", "SHAKE128", { length: 0 })).length, 0)
    }))

  it.effect("fails with a CryptoError for a length on a fixed-length algorithm", () =>
    Effect.gen(function*() {
      const error = yield* assertFailsWithTag(Crypto.digest("abc", "SHA3-256", { length: 8 }), "CryptoError")
      assertEquals(error.operation, "digest")
    }))

  it.effect("fails with a CryptoError for an unknown algorithm", () =>
    Effect.gen(function*() {
      yield* assertFailsWithTag(Crypto.digest("abc", "NOPE" as Crypto.DigestAlgorithm), "CryptoError")
    }))

  it("isDigestAlgorithm", () => {
    assert(Crypto.isDigestAlgorithm("blake3"))
    assert(Crypto.isDigestAlgorithm("SHA-256"))
    assertFalse(Crypto.isDigestAlgorithm("SHA-0"))
  })
})

describe("digestStream", () => {
  const chunks = ["taking ", "the hobbits ", "to isengard"].map((s) => new TextEncoder().encode(s))

  it.effect("hashes a stream like the concatenated bytes", () =>
    Effect.gen(function*() {
      for (const algorithm of ["BLAKE3", "SHA-256", "SHA3-512", "FNV64A"] as const) {
        const streamed = yield* Crypto.digestStream(Stream.fromIterable(chunks), algorithm)
        const whole = yield* Crypto.digest("taking the hobbits to isengard", algorithm)
        assertEquals(Hex.encode(streamed), Hex.encode(whole), algorithm)
      }
    }))

  it.effect("is pipeable and supports a length", () =>
    Effect.gen(function*() {
      const hash = yield* Stream.fromIterable(chunks).pipe(Crypto.digestStream("BLAKE3", { length: 16 }))
      assertEquals(hash.length, 16)
    }))

  it.effect("hashes an empty stream", () =>
    Effect.gen(function*() {
      assertEquals(Hex.encode(yield* Crypto.digestStream(Stream.empty, "MD5")), EMPTY.MD5)
    }))

  it.effect("propagates stream failures", () =>
    Effect.gen(function*() {
      const error = yield* Crypto.digestStream(Stream.fail("boom" as const), "BLAKE3").pipe(Effect.flip)
      assertEquals(error, "boom")
    }))

  it.effect("fails with a CryptoError for an unknown algorithm", () =>
    Effect.gen(function*() {
      yield* assertFailsWithTag(
        Crypto.digestStream(Stream.fromIterable(chunks), "NOPE" as Crypto.DigestAlgorithm),
        "CryptoError",
      )
    }))
})

describe("timingSafeEqual", () => {
  it("compares bytes", () => {
    assert(Crypto.timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])))
    assertFalse(Crypto.timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4])))
    assert(Crypto.timingSafeEqual(new Uint8Array(), new Uint8Array()))
  })

  it("treats different lengths as unequal", () => {
    assertFalse(Crypto.timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3])))
  })

  it("is pipeable", () => {
    assert(Crypto.timingSafeEqual(new Uint8Array([7]))(new Uint8Array([7])))
  })
})

describe("AES-GCM", () => {
  it.effect("round-trips with a generated key", () =>
    Effect.gen(function*() {
      const key = yield* Crypto.generateAesGcmKey()
      const sealed = yield* Crypto.encryptAesGcm(key, "hello")
      assertEquals(sealed.byteLength, 12 + 5 + 16)
      assertEquals(new TextDecoder().decode(yield* Crypto.decryptAesGcm(key, sealed)), "hello")
    }).pipe(Effect.provide(Crypto.WebCrypto.layer)))

  it.effect("uses a fresh nonce per call", () =>
    Effect.gen(function*() {
      const key = yield* Crypto.generateAesGcmKey(128)
      const a = yield* Crypto.encryptAesGcm(key, "same")
      const b = yield* Crypto.encryptAesGcm(key, "same")
      assertNotEquals(Hex.encode(a), Hex.encode(b))
    }).pipe(Effect.provide(Crypto.WebCrypto.layer)))

  it.effect("matches the NIST AES-128-GCM vector (zero key, zero nonce)", () =>
    Effect.gen(function*() {
      const key = yield* Crypto.importAesGcmKey(Redacted.make(new Uint8Array(16)))
      const sealed = yield* Crypto.encryptAesGcm(key, new Uint8Array(16))
      assertEquals(
        Hex.encode(sealed),
        "000000000000000000000000" + "0388dace60b6a392f328c2b971b2fe78" + "ab6e47d42cec13bdf53a67b21257bddf",
      )
    }).pipe(Effect.provide(ZeroCrypto)))

  it.effect("authenticates additional data", () =>
    Effect.gen(function*() {
      const key = yield* Crypto.generateAesGcmKey()
      const sealed = yield* Crypto.encryptAesGcm(key, "data", { additionalData: "header" })
      assertEquals(
        new TextDecoder().decode(yield* Crypto.decryptAesGcm(key, sealed, { additionalData: "header" })),
        "data",
      )
      yield* assertFailsWithTag(Crypto.decryptAesGcm(key, sealed, { additionalData: "other" }), "CryptoError")
      yield* assertFailsWithTag(Crypto.decryptAesGcm(key, sealed), "CryptoError")
    }).pipe(Effect.provide(Crypto.WebCrypto.layer)))

  it.effect("rejects tampered ciphertext, a wrong key and short input", () =>
    Effect.gen(function*() {
      const key = yield* Crypto.generateAesGcmKey()
      const other = yield* Crypto.generateAesGcmKey()
      const sealed = yield* Crypto.encryptAesGcm(key, "data")
      const tampered = sealed.slice()
      tampered[14]! ^= 1
      yield* assertFailsWithTag(Crypto.decryptAesGcm(key, tampered), "CryptoError")
      yield* assertFailsWithTag(Crypto.decryptAesGcm(other, sealed), "CryptoError")
      const short = yield* assertFailsWithTag(Crypto.decryptAesGcm(key, new Uint8Array(27)), "CryptoError")
      assertEquals(short.operation, "decrypt")
    }).pipe(Effect.provide(Crypto.WebCrypto.layer)))

  it.effect("exports and re-imports a key", () =>
    Effect.gen(function*() {
      const key = yield* Crypto.generateAesGcmKey()
      const raw = yield* Crypto.exportKey(key)
      assertEquals(Redacted.value(raw).length, 32)
      const sealed = yield* Crypto.encryptAesGcm(key, "data")
      const again = yield* Crypto.importAesGcmKey(raw)
      assertEquals(new TextDecoder().decode(yield* Crypto.decryptAesGcm(again, sealed)), "data")
    }).pipe(Effect.provide(Crypto.WebCrypto.layer)))

  it.effect("fails to import a key of an invalid length", () =>
    Effect.gen(function*() {
      yield* assertFailsWithTag(Crypto.importAesGcmKey(Redacted.make(new Uint8Array(7))), "CryptoError")
    }))
})

describe("HMAC", () => {
  // RFC 4231, test case 2.
  const expected = "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"

  it.effect("signs with a redacted secret", () =>
    Effect.gen(function*() {
      const mac = yield* Crypto.hmacSign(Redacted.make("Jefe"), "what do ya want for nothing?")
      assertEquals(Hex.encode(mac), expected)
    }))

  it.effect("signs and verifies with an imported key", () =>
    Effect.gen(function*() {
      const key = yield* Crypto.importHmacKey(Redacted.make(new TextEncoder().encode("Jefe")), { hash: "SHA-256" })
      const mac = yield* Crypto.hmacSign(key, "what do ya want for nothing?")
      assertEquals(Hex.encode(mac), expected)
      assert(yield* Crypto.hmacVerify(key, "what do ya want for nothing?", mac))
      assertFalse(yield* Crypto.hmacVerify(key, "something else", mac))
    }))

  it.effect("uses the requested hash", () =>
    Effect.gen(function*() {
      const mac = yield* Crypto.hmacSign(Redacted.make("Jefe"), "what do ya want for nothing?", { hash: "SHA-512" })
      assertEquals(mac.length, 64)
      assert(yield* Crypto.hmacVerify(Redacted.make("Jefe"), "what do ya want for nothing?", mac, { hash: "SHA-512" }))
    }))
})

describe("key derivation", () => {
  it.effect("pbkdf2 matches the RFC 7914 vector", () =>
    Effect.gen(function*() {
      const key = yield* Crypto.pbkdf2(Redacted.make("password"), { salt: "salt", iterations: 1 })
      assertEquals(Hex.encode(Redacted.value(key)), "120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b")
    }))

  it.effect("pbkdf2 honours length and hash", () =>
    Effect.gen(function*() {
      const key = yield* Crypto.pbkdf2(Redacted.make("password"), {
        salt: "salt",
        iterations: 2,
        hash: "SHA-1",
        length: 20,
      })
      assertEquals(Hex.encode(Redacted.value(key)), "ea6c014dc72d6f8ccd1ed92ace1d41f0d8de8957")
    }))

  it.effect("hkdf matches RFC 5869 test case 1", () =>
    Effect.gen(function*() {
      const key = yield* Crypto.hkdf(Redacted.make(hex("0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b")), {
        salt: hex("000102030405060708090a0b0c"),
        info: hex("f0f1f2f3f4f5f6f7f8f9"),
        length: 42,
      })
      assertEquals(
        Hex.encode(Redacted.value(key)),
        "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865",
      )
    }))

  it.effect("fails with a CryptoError on invalid parameters", () =>
    Effect.gen(function*() {
      yield* assertFailsWithTag(Crypto.pbkdf2(Redacted.make("pw"), { salt: "s", iterations: 0 }), "CryptoError")
    }))
})

describe("WebCrypto", () => {
  it.effect("provides random bytes and SHA digests", () =>
    Effect.gen(function*() {
      const crypto = yield* EffectCrypto.Crypto
      const bytes = yield* crypto.randomBytes(100_000)
      assertEquals(bytes.length, 100_000)
      assert(bytes.some((b) => b !== 0))
      const hash = yield* crypto.digest("SHA-256", new TextEncoder().encode("abc"))
      assertEquals(Hex.encode(hash), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
      assertEquals((yield* crypto.randomUUIDv4).length, 36)
    }).pipe(Effect.provide(Crypto.WebCrypto.layer)))

  it("make builds a service", () => {
    const service = Crypto.WebCrypto.make()
    const n = service.nextDoubleUnsafe()
    assert(n >= 0 && n < 1)
  })
})
