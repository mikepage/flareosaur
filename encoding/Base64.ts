// Copyright 2026 the flareosaur authors. MIT license.

/**
 * Base64 (RFC 4648 §4), from `effect/encoding/Base64`, plus Stream
 * transforms.
 *
 * `encode`, `decode` and `decodeString` are Effect's own: decoding returns a
 * `Result` that fails with an `EncodingError`. This module adds
 * {@linkcode encodeStream} and {@linkcode decodeStream}, which work on
 * streams of chunks of any size, like `@std/encoding`'s
 * `Base64EncoderStream` and `Base64DecoderStream`.
 *
 * ```ts
 * import { Effect, Stream } from "effect"
 * import * as Base64 from "@mikepage/flareosaur/encoding/base64"
 *
 * Base64.encode("hello") // "aGVsbG8="
 *
 * const program = Stream.make(new Uint8Array([104, 101]), new Uint8Array([108, 108, 111])).pipe(
 *   Base64.encodeStream,
 *   Stream.mkString,
 * ) // Effect<"aGVsbG8=">
 * ```
 *
 * @module
 */

import type { Stream } from "effect"
import * as Base64 from "effect/encoding/Base64"
import type { EncodingError } from "effect/encoding/EncodingError"
import { decodeStream as decodeBlocks, encodeStream as encodeBlocks } from "./_shared.ts"

export * from "effect/encoding/Base64"

/** Encodes a stream of bytes as a stream of Base64 text. */
export const encodeStream: <E, R>(self: Stream.Stream<Uint8Array, E, R>) => Stream.Stream<string, E, R> =
  encodeBlocks(3, Base64.encode)

/**
 * Decodes a stream of Base64 text into a stream of bytes. Line breaks are
 * ignored. Fails with an `EncodingError` on invalid input.
 */
export const decodeStream: <E, R>(self: Stream.Stream<string, E, R>) => Stream.Stream<Uint8Array, E | EncodingError, R> =
  decodeBlocks(4, Base64.decode, /[\r\n]/g)
