// Copyright 2026 the flareosaur authors. MIT license.

/**
 * Hexadecimal (base16), from `effect/encoding/Hex`, plus Stream transforms.
 *
 * `encode` writes lowercase hex; `decode` returns a `Result` that fails with
 * an `EncodingError`. This module adds {@linkcode encodeStream} and
 * {@linkcode decodeStream} for streams of chunks of any size, like
 * `@std/encoding`'s `HexEncoderStream` and `HexDecoderStream`.
 *
 * ```ts
 * import { Stream } from "effect"
 * import * as Hex from "@mikepage/flareosaur/encoding/hex"
 *
 * Hex.encode("abc") // "616263"
 *
 * const program = Stream.make("616", "263").pipe(Hex.decodeStream, Stream.decodeText, Stream.mkString)
 * // Effect<"abc">
 * ```
 *
 * @module
 */

import type { Stream } from "effect"
import * as Hex from "effect/encoding/Hex"
import type { EncodingError } from "effect/encoding/EncodingError"
import { decodeStream as decodeBlocks, encodeStream as encodeBlocks } from "./_shared.ts"

export * from "effect/encoding/Hex"

/** Encodes a stream of bytes as a stream of lowercase hex text. */
export const encodeStream: <E, R>(self: Stream.Stream<Uint8Array, E, R>) => Stream.Stream<string, E, R> =
  encodeBlocks(1, Hex.encode)

/** Decodes a stream of hex text into a stream of bytes. Fails with an `EncodingError` on invalid input. */
export const decodeStream: <E, R>(self: Stream.Stream<string, E, R>) => Stream.Stream<Uint8Array, E | EncodingError, R> =
  decodeBlocks(2, Hex.decode)
