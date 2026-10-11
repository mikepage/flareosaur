// Copyright 2026 the flareosaur authors. MIT license.

/**
 * URL-safe Base64 (RFC 4648 §5), from `effect/encoding/Base64Url`, plus
 * Stream transforms.
 *
 * `encode` writes unpadded output; `decode` accepts padded and unpadded
 * input and returns a `Result` that fails with an `EncodingError`. This
 * module adds {@linkcode encodeStream} and {@linkcode decodeStream} for
 * streams of chunks of any size.
 *
 * ```ts
 * import { Stream } from "effect"
 * import * as Base64Url from "@mikepage/flareosaur/encoding/base64-url"
 *
 * Base64Url.encode("hello?") // "aGVsbG8_"
 *
 * const program = Stream.make("aGVs", "bG8_").pipe(Base64Url.decodeStream, Stream.decodeText, Stream.mkString)
 * // Effect<"hello?">
 * ```
 *
 * @module
 */

import * as Base64Url from "effect/encoding/Base64Url"
import { decodeStream as decodeBlocks, encodeStream as encodeBlocks } from "./_shared.ts"

export * from "effect/encoding/Base64Url"

/** Encodes a stream of bytes as a stream of unpadded URL-safe Base64 text. */
export const encodeStream = encodeBlocks(3, Base64Url.encode)

/**
 * Decodes a stream of URL-safe Base64 text into a stream of bytes. Line
 * breaks are ignored. Fails with an `EncodingError` on invalid input.
 */
export const decodeStream = decodeBlocks(4, Base64Url.decode, /[\r\n]/g)
