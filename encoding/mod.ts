// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * Binary-to-text encodings and varints, in the style of `effect/encoding`.
 *
 * Base64, Base64Url and Hex are Effect's own modules; the others come from
 * `@std/encoding` with the same shape: `encode` returns a string, `decode`
 * and `decodeString` return a `Result` that fails with Effect's
 * `EncodingError`. The block-aligned encodings also have `encodeStream` and
 * `decodeStream`, which transform an Effect `Stream` of chunks of any size.
 *
 * | Module | Alphabet | Streams |
 * | --- | --- | --- |
 * | {@linkcode Base64} | RFC 4648 §4 | yes |
 * | {@linkcode Base64Url} | RFC 4648 §5, unpadded | yes |
 * | {@linkcode Hex} | lowercase base16 | yes |
 * | {@linkcode Base32} | RFC 4648 §6 | yes |
 * | {@linkcode Base32Hex} | RFC 4648 §7 | yes |
 * | {@linkcode Base32Crockford} | Crockford | yes |
 * | {@linkcode Base58} | Bitcoin | no |
 * | {@linkcode Ascii85} | Adobe, btoa, RFC 1924, Z85 | no |
 * | {@linkcode Varint} | unsigned LEB128 | no |
 *
 * ```ts
 * import { Result, Stream } from "effect"
 * import { Base32, Base58, Base64, EncodingError } from "@mikepage/flareosaur/encoding"
 *
 * Base32.encode("Hello world!") // "JBSWY3DPEB3W64TMMQQQ===="
 * Base58.encode("Hello world!") // "2NEpo7TZRhna7vSvL"
 * Base64.decodeString("SGVsbG8gd29ybGQh") // Result.succeed("Hello world!")
 *
 * const result = Base32.decode("not base32!")
 * Result.isFailure(result) && EncodingError.isEncodingError(result.failure) // true
 *
 * const text = Stream.make(new TextEncoder().encode("Hello world!")).pipe(Base32.encodeStream, Stream.mkString)
 * ```
 *
 * @module
 */

export * as Ascii85 from "./Ascii85.ts"
export * as Base32 from "./Base32.ts"
export * as Base32Crockford from "./Base32Crockford.ts"
export * as Base32Hex from "./Base32Hex.ts"
export * as Base58 from "./Base58.ts"
export * as Base64 from "./Base64.ts"
export * as Base64Url from "./Base64Url.ts"
export * as Hex from "./Hex.ts"
export * as Varint from "./Varint.ts"

/** Effect's `EncodingError` module, the error every decoder here reports. */
export * as EncodingError from "effect/encoding/EncodingError"
