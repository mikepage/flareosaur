// Copyright 2026 the flareosaur authors. MIT license.
// Helpers shared by the encoding modules: EncodingError construction and
// block-aligned Stream transforms.

import { Effect, Result, Stream } from "effect"
import { EncodingError } from "effect/encoding/EncodingError"

const messageOf = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause)

/** Runs `f`, turning a thrown error into an `EncodingError` for `module`. */
export const attempt = <A>(
  module: string,
  kind: "Decode" | "Encode",
  input: unknown,
  f: () => A,
): Result.Result<A, EncodingError> => {
  try {
    return Result.succeed(f())
  } catch (cause) {
    return Result.fail(new EncodingError({ kind, module, input, message: messageOf(cause) }))
  }
}

const concat = (a: Uint8Array, b: Uint8Array): Uint8Array => {
  if (a.length === 0) return b
  const out = new Uint8Array(a.length + b.length)
  out.set(a)
  out.set(b, a.length)
  return out
}

/**
 * Encodes a stream of bytes in blocks of `blockSize` bytes, so each emitted
 * string is a complete, independently decodable piece of the output. The
 * last, partial block is encoded when the stream ends.
 */
export const encodeStream = (blockSize: number, encode: (bytes: Uint8Array) => string) =>
<E, R>(self: Stream.Stream<Uint8Array, E, R>): Stream.Stream<string, E, R> =>
  self.pipe(
    Stream.mapAccum(
      () => ({ pending: new Uint8Array(0) as Uint8Array }),
      (state, chunk: Uint8Array) => {
        const bytes = concat(state.pending, chunk)
        const cut = bytes.length - (bytes.length % blockSize)
        state.pending = bytes.slice(cut)
        return [state, cut > 0 ? [encode(bytes.subarray(0, cut))] : []] as const
      },
      { onHalt: (state) => state.pending.length > 0 ? [encode(state.pending)] : [] },
    ),
  )

/**
 * Decodes a stream of text in blocks of `blockSize` characters, after
 * removing the characters matched by `ignore`. The last, partial block is
 * decoded when the stream ends. Fails with the decoder's `EncodingError`.
 */
export const decodeStream = (
  blockSize: number,
  decode: (text: string) => Result.Result<Uint8Array, EncodingError>,
  ignore?: RegExp,
) =>
<E, R>(self: Stream.Stream<string, E, R>): Stream.Stream<Uint8Array, E | EncodingError, R> =>
  self.pipe(
    Stream.mapAccum(
      () => ({ pending: "" }),
      (state, chunk: string) => {
        const text = state.pending + (ignore ? chunk.replace(ignore, "") : chunk)
        const cut = text.length - (text.length % blockSize)
        state.pending = text.slice(cut)
        return [state, cut > 0 ? [text.slice(0, cut)] : []] as const
      },
      { onHalt: (state) => state.pending.length > 0 ? [state.pending] : [] },
    ),
    Stream.mapEffect((text) => Effect.fromResult(decode(text))),
  )
