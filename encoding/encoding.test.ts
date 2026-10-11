// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.
import { Effect, Result, Stream } from "effect"
import { describe, it } from "../testing/mod.ts"
import { assert, assertEquals, assertFailsWithTag, assertFailure, assertStringIncludes, assertSuccess } from "../assert/mod.ts"
import {
  Ascii85,
  Base32,
  Base32Crockford,
  Base32Hex,
  Base58,
  Base64,
  Base64Url,
  EncodingError,
  Hex,
  Varint,
} from "./mod.ts"

const bytes = (text: string) => new TextEncoder().encode(text)

const collect = <A, E>(stream: Stream.Stream<A, E>) => Effect.map(Stream.runCollect(stream), (a) => [...a])

const concat = (chunks: ReadonlyArray<Uint8Array>): Uint8Array => {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

// Splits `input` into chunks of 1, 2, 3, ... elements.
const slices = <A extends { readonly length: number; slice(start: number, end: number): A }>(input: A): Array<A> => {
  const out: Array<A> = []
  for (let i = 0, n = 1; i < input.length; i += n, n = n % 7 + 1) out.push(input.slice(i, i + n))
  return out
}

const assertEncodingError = (result: Result.Result<unknown, unknown>, module: string, includes?: string) => {
  const error = assertFailure(result)
  assert(EncodingError.isEncodingError(error))
  assertEquals(error.kind, "Decode")
  assertEquals(error.module, module)
  if (includes) assertStringIncludes(error.message, includes)
}

describe("Base32", () => {
  // RFC 4648 §10 test vectors.
  const vectors = [
    ["", ""],
    ["f", "MY======"],
    ["fo", "MZXQ===="],
    ["foo", "MZXW6==="],
    ["foob", "MZXW6YQ="],
    ["fooba", "MZXW6YTB"],
    ["foobar", "MZXW6YTBOI======"],
  ] as const

  it("encodes and decodes the RFC 4648 vectors", () => {
    for (const [text, b32] of vectors) {
      assertEquals(Base32.encode(text), b32)
      assertEquals(Base32.encode(bytes(text)), b32)
      assertEquals(assertSuccess(Base32.decode(b32)), bytes(text))
      assertEquals(assertSuccess(Base32.decodeString(b32)), text)
    }
    assertEquals(assertSuccess(Base32.decodeString("MZXW6")), "foo")
  })

  it("does not consume the input bytes", () => {
    const input = bytes("hello")
    Base32.encode(input)
    assertEquals(input, bytes("hello"))
    const view = new Uint8Array([0, 1, 2, 3]).subarray(1)
    Base32.encode(view)
    assertEquals(view, new Uint8Array([1, 2, 3]))
  })

  it("fails with an EncodingError on invalid input", () => {
    assertEncodingError(Base32.decode("5HXR334AQYAAAA=========="), "Base32", "Invalid character (=)")
    assertEncodingError(Base32.decode("........MZXW6==="), "Base32", "Invalid character (.)")
    assertEncodingError(Base32.decode("MZXW6YTBA"), "Base32", "must not have a remainder")
  })

  it("Base32Hex and Base32Crockford use their alphabets", () => {
    assertEquals(Base32Hex.encode("AAAAAA"), "850K2GA184======")
    assertEquals(Base32Crockford.encode("AAA"), "850M2===")
    assertEquals(assertSuccess(Base32Hex.decodeString("850K2===")), "AAA")
    assertEquals(assertSuccess(Base32Crockford.decodeString("850M2GA1")), "AAAAA")
    assertEncodingError(Base32Hex.decode("WWWWWWWW"), "Base32Hex")
    assertEncodingError(Base32Crockford.decode("IIIIIIII"), "Base32Crockford")
  })

  it.effect("streams encode and decode across arbitrary chunks", () =>
    Effect.gen(function*() {
      const input = bytes("The quick brown fox jumps over the lazy dog, 0123456789!")
      for (const codec of [Base32, Base32Hex, Base32Crockford]) {
        const text = (yield* collect(Stream.fromIterable(slices(input)).pipe(codec.encodeStream))).join("")
        assertEquals(text, codec.encode(input))
        const decoded = yield* collect(Stream.fromIterable(slices(text)).pipe(codec.decodeStream))
        assertEquals(concat(decoded), input)
      }
    }))

  it.effect("decodeStream fails with an EncodingError", () =>
    Effect.gen(function*() {
      const error = yield* assertFailsWithTag(collect(Stream.make("MZXW6===", "!!!!!!!!").pipe(Base32.decodeStream)), "EncodingError")
      assertEquals(error.module, "Base32")
    }))
})

describe("Base58", () => {
  const vectors = [
    ["", ""],
    ["f", "2m"],
    ["ß", "FtS"],
    ["foobar", "t1Zv2yaZ"],
    ["Hello World!", "2NEpo7TZRRrLZSi2U"],
  ] as const

  it("encodes and decodes", () => {
    for (const [text, b58] of vectors) {
      assertEquals(Base58.encode(text), b58)
      assertEquals(assertSuccess(Base58.decodeString(b58)), text)
    }
    const binary = new Uint8Array([0, 0, 0, 40, 127, 180, 205])
    assertEquals(Base58.encode(binary), "111233QC4")
    assertEquals(assertSuccess(Base58.decode("111233QC4")), binary)
  })

  it("fails with an EncodingError on invalid input", () => {
    assertEncodingError(Base58.decode("+2NEpo7TZRRrLZSi2U"), "Base58", "Invalid base58 char at index 0 with value +")
  })
})

describe("Ascii85", () => {
  const vectors = [
    ["Adobe", "Hello world!", "87cURD]j7BEbo80"],
    ["Adobe", "\0\0\0\0\0", "z!!"],
    ["btoa", "    ", "y"],
    ["RFC 1924", "Hello world!", "NM&qnZy<MXa%^NF"],
    ["Z85", "Hello world!", "nm=QNzY<mxA+]nf"],
    ["Z85", "\0\0\0\0", "00000"],
  ] as const

  it("encodes and decodes in every standard", () => {
    for (const [standard, text, encoded] of vectors) {
      assertEquals(Ascii85.encode(text, { standard }), encoded)
      assertEquals(assertSuccess(Ascii85.decode(encoded, { standard })), bytes(text))
    }
    assertEquals(assertSuccess(Ascii85.decodeString("87cURD]j7BEbo80")), "Hello world!")
  })

  it("writes and reads delimiters", () => {
    assertEquals(Ascii85.encode("test", { delimiter: true }), "<~FCfN8~>")
    assertEquals(Ascii85.encode("test", { standard: "btoa", delimiter: true }), "xbtoa Begin\nFCfN8\nxbtoa End")
    assertEquals(assertSuccess(Ascii85.decodeString("<~FCfN8~>")), "test")
    assertEquals(assertSuccess(Ascii85.decodeString("xbtoa Begin\nFCfN8\nxbtoa End", { standard: "btoa" })), "test")
    assertEquals(assertSuccess(Ascii85.decodeString("!!!!!")), "\0\0\0\0")
  })

  it("fails with an EncodingError on characters outside the alphabet or a bad length", () => {
    assertEncodingError(Ascii85.decode("87cURD]j7BEbo80~~"), "Ascii85", "character")
    assertEncodingError(Ascii85.decode("nm=QNz\"", { standard: "Z85" }), "Ascii85", "character")
    assertEncodingError(Ascii85.decode("87cUR!"), "Ascii85", "length")
  })
})

describe("Base64, Base64Url and Hex", () => {
  it("re-export Effect's codecs", () => {
    assertEquals(Base64.encode("ice creams"), "aWNlIGNyZWFtcw==")
    assertEquals(Base64Url.encode("ice creams"), "aWNlIGNyZWFtcw")
    assertEquals(Hex.encode("Hello world!"), "48656c6c6f20776f726c6421")
    assertEquals(assertSuccess(Base64.decodeString("SGVsbG8gd29ybGQh")), "Hello world!")
    assertEncodingError(Base64.decode("SGV"), "Base64")
    assertEncodingError(Hex.decode("zz"), "Hex")
  })

  it.effect("streams encode and decode across arbitrary chunks", () =>
    Effect.gen(function*() {
      const input = bytes("The quick brown fox jumps over the lazy dog? <3 ÿ")
      for (const codec of [Base64, Base64Url, Hex]) {
        const text = (yield* collect(Stream.fromIterable(slices(input)).pipe(codec.encodeStream))).join("")
        assertEquals(text, codec.encode(input))
        const decoded = yield* collect(Stream.fromIterable(slices(text)).pipe(codec.decodeStream))
        assertEquals(concat(decoded), input)
      }
    }))

  it.effect("Base64 decodeStream ignores line breaks", () =>
    Effect.gen(function*() {
      const decoded = yield* collect(Stream.make("SGVs\r\nbG8g", "d29y\nbGQh").pipe(Base64.decodeStream))
      assertEquals(new TextDecoder().decode(concat(decoded)), "Hello world!")
    }))

  it.effect("decodeStream fails with an EncodingError", () =>
    Effect.gen(function*() {
      yield* assertFailsWithTag(collect(Stream.make("SGVs", "b!8g").pipe(Base64.decodeStream)), "EncodingError")
      yield* assertFailsWithTag(collect(Stream.make("0g").pipe(Hex.decodeStream)), "EncodingError")
    }))
})

describe("Varint", () => {
  it("encodes", () => {
    assertEquals(assertSuccess(Varint.encode(300, new Uint8Array(2))), [Uint8Array.of(172, 2), 2])
    assertEquals(assertSuccess(Varint.encode(4294967295)), [Uint8Array.of(255, 255, 255, 255, 15), 5])
    assertEquals(
      assertSuccess(Varint.encode(Varint.MaxUint64)),
      [Uint8Array.of(255, 255, 255, 255, 255, 255, 255, 255, 255, 1), 10],
    )
    const buf = new Uint8Array(3)
    assertEquals(assertSuccess(Varint.encode(300, buf, 1)), [Uint8Array.of(172, 2), 3])
    assertEquals(buf, Uint8Array.of(0, 172, 2))
  })

  it("fails to encode negative, oversized or unfitting numbers", () => {
    const negative = assertFailure(Varint.encode(-1))
    assertEquals(negative.kind, "Encode")
    assertStringIncludes(negative.message, "non-negative")
    assertStringIncludes(assertFailure(Varint.encode(0x1234567891234567891n)).message, "overflows uint64")
    assertStringIncludes(assertFailure(Varint.encode(Varint.MaxUint64, new Uint8Array(5))).message, "too small")
  })

  it("decodes 64-bit varints", () => {
    assertEquals(assertSuccess(Varint.decode(Uint8Array.of(172, 2))), [300n, 2])
    assertEquals(
      assertSuccess(Varint.decode(Uint8Array.of(255, 255, 255, 255, 255, 255, 255, 255, 255, 1))),
      [Varint.MaxUint64, 10],
    )
    assertEquals(assertSuccess(Varint.decode(Uint8Array.of(0, 0, 0, 0, 172, 2), 4)), [300n, 6])
    assertEncodingError(Varint.decode(Uint8Array.of()), "Varint")
    assertEncodingError(Varint.decode(Uint8Array.of(255, 255, 255, 255, 255, 255, 255, 255, 255, 2)), "Varint")
    assertEncodingError(Varint.decode(Uint8Array.of(172)), "Varint")
  })

  it("decodes 32-bit varints", () => {
    assertEquals(assertSuccess(Varint.decode32(Uint8Array.of(172, 2))), [300, 2])
    assertEquals(assertSuccess(Varint.decode32(Uint8Array.of(255, 255, 255, 255, 15, 0, 0))), [4294967295, 5])
    assertEncodingError(Varint.decode32(Uint8Array.of(255, 255, 255, 255, 255, 255, 255, 255, 15, 0)), "Varint")
    assertEncodingError(Varint.decode32(Uint8Array.of(172)), "Varint")
  })

  it("round-trips", () => {
    for (let i = 0x7n; i < Varint.MaxUint64; i <<= 1n) {
      const [encoded] = assertSuccess(Varint.encode(i))
      assertEquals(assertSuccess(Varint.decode(encoded)), [i, encoded.length])
    }
    for (const n of [0, 1, 127, 128, 300, 4294967295]) {
      const [encoded] = assertSuccess(Varint.encode(n))
      assertEquals(assertSuccess(Varint.decode32(encoded)), [n, encoded.length])
    }
  })
})
