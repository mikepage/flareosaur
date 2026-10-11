// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * Base32 with the extended hex alphabet (RFC 4648 §7, `0-9A-V`), from
 * `@std/encoding`, in the style of `effect/encoding/Base64`. Unlike Base32,
 * encoded strings sort in the same order as the bytes they encode.
 *
 * `encode` writes padded output. `decode` accepts padded and unpadded input
 * and returns a `Result` that fails with Effect's `EncodingError`.
 * {@linkcode encodeStream} and {@linkcode decodeStream} work on streams of
 * chunks of any size.
 *
 * ```ts
 * import * as Base32Hex from "@mikepage/flareosaur/encoding/base32-hex"
 *
 * Base32Hex.encode("foo") // "CPNMU==="
 * Base32Hex.decodeString("CPNMU===") // Result.succeed("foo")
 * ```
 *
 * @module
 */

import type { Result } from "effect"
import type { EncodingError } from "effect/encoding/EncodingError"
import { decoder32, encoder, stringDecoder } from "./_base32.ts"
import { decodeStream as decodeBlocks, encodeStream as encodeBlocks } from "./_shared.ts"

/** Encodes bytes, or a string as UTF-8, as padded Base32Hex. */
export const encode: (input: Uint8Array | string) => string = encoder("base32hex")

/** Decodes Base32Hex into bytes. Fails with an `EncodingError` on invalid characters or length. */
export const decode: (str: string) => Result.Result<Uint8Array, EncodingError> = decoder32("base32hex", "Base32Hex")

/** Decodes Base32Hex into a UTF-8 string. */
export const decodeString: (str: string) => Result.Result<string, EncodingError> = stringDecoder(decode)

/** Encodes a stream of bytes as a stream of Base32Hex text. */
export const encodeStream = encodeBlocks(5, encode)

/** Decodes a stream of Base32Hex text into a stream of bytes. Fails with an `EncodingError` on invalid input. */
export const decodeStream = decodeBlocks(8, decode)
