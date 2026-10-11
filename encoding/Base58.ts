// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * Base58 with the Bitcoin alphabet (no `0`, `O`, `I`, `l`), from
 * `@std/encoding`, in the style of `effect/encoding/Base64`. Leading zero
 * bytes are kept as leading `1`s.
 *
 * `decode` returns a `Result` that fails with Effect's `EncodingError`.
 * Base58 is not block-aligned, so there are no stream transforms.
 *
 * ```ts
 * import * as Base58 from "@mikepage/flareosaur/encoding/base58"
 *
 * Base58.encode("Hello World!") // "2NEpo7TZRRrLZSi2U"
 * Base58.decodeString("2NEpo7TZRRrLZSi2U") // Result.succeed("Hello World!")
 * ```
 *
 * @module
 */

import { Result } from "effect"
import type { EncodingError } from "effect/encoding/EncodingError"
import { decodeBase58, encodeBase58 } from "./_std/base58.ts"
import { attempt } from "./_shared.ts"

const decoder = new TextDecoder()

/** Encodes bytes, or a string as UTF-8, as Base58. */
export const encode = (input: Uint8Array | string): string => encodeBase58(input)

/** Decodes Base58 into bytes. Fails with an `EncodingError` on a character outside the alphabet. */
export const decode = (str: string): Result.Result<Uint8Array, EncodingError> =>
  attempt("Base58", "Decode", str, () => decodeBase58(str))

/** Decodes Base58 into a UTF-8 string. */
export const decodeString = (str: string): Result.Result<string, EncodingError> =>
  Result.map(decode(str), (bytes) => decoder.decode(bytes))
