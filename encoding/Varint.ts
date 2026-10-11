// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * Unsigned LEB128 variable-length integers, as used by Protocol Buffers and
 * Go's `encoding/binary`, from `@std/encoding`, returning `Result`s that fail
 * with Effect's `EncodingError` instead of throwing.
 *
 * ```ts
 * import { Result } from "effect"
 * import * as Varint from "@mikepage/flareosaur/encoding/varint"
 *
 * Varint.encode(300) // Result.succeed([Uint8Array [0xac, 0x02], 2])
 * Varint.decode(new Uint8Array([0xac, 0x02])) // Result.succeed([300n, 2])
 * Varint.decode32(new Uint8Array([0xac, 0x02])) // Result.succeed([300, 2])
 * ```
 *
 * @module
 */

import type { Result } from "effect"
import type { EncodingError } from "effect/encoding/EncodingError"
import * as std from "./_std/varint.ts"
import { attempt } from "./_shared.ts"

/** The largest value a varint can hold: 2^64 - 1. */
export const MaxUint64: bigint = std.MaxUint64

/** The most bytes a 32-bit varint takes. */
export const MaxVarintLen32: number = std.MaxVarintLen32

/** The most bytes a 64-bit varint takes. */
export const MaxVarintLen64: number = std.MaxVarintLen64

/**
 * Encodes a non-negative integer of at most 64 bits as a varint, written
 * into `buf` (a new 10-byte buffer by default) at `offset`. Succeeds with
 * the encoded bytes and the offset just after them. Fails when the number
 * is negative or too large, or `buf` is too small.
 */
export const encode = (
  num: number | bigint,
  buf?: Uint8Array,
  offset?: number,
): Result.Result<[Uint8Array, number], EncodingError> =>
  attempt("Varint", "Encode", num, () => std.encodeVarint(num, buf, offset))

/**
 * Decodes a varint of up to 64 bits from `buf` at `offset` (0 by default).
 * Succeeds with the value as a `bigint` and the offset just after it. Fails
 * on an empty buffer, a truncated varint, or one that overflows 64 bits.
 */
export const decode = (buf: Uint8Array, offset?: number): Result.Result<[bigint, number], EncodingError> =>
  attempt("Varint", "Decode", buf, () => std.decodeVarint(buf, offset))

/**
 * Decodes a varint of up to 32 bits from `buf` at `offset` (0 by default).
 * Succeeds with the value as a `number` and the offset just after it. Fails
 * on a truncated varint or one longer than {@linkcode MaxVarintLen32} bytes.
 */
export const decode32 = (buf: Uint8Array, offset?: number): Result.Result<[number, number], EncodingError> =>
  attempt("Varint", "Decode", buf, () => {
    const result = std.decodeVarint32(buf, offset)
    // std reads past the end of a truncated varint as if it were terminated.
    if (result[1] > buf.length) throw new RangeError("Cannot decode the varint input: Malformed or truncated varint")
    return result
  })
