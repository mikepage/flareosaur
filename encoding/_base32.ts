// Copyright 2026 the flareosaur authors. MIT license.
// The three Base32 variants share std's implementation; they differ only in
// the alphabet.

import { Result } from "effect"
import type { EncodingError } from "effect/encoding/EncodingError"
import { type Base32Alphabet, decodeBase32, encodeBase32 } from "./_std/unstable_base32.ts"
import { attempt } from "./_shared.ts"

const decoder = new TextDecoder()

// std's encoder transfers the input's ArrayBuffer to reuse it as output, which
// would detach the caller's bytes, so it gets a copy.
export const encoder = (alphabet: Base32Alphabet) => (input: Uint8Array | string): string =>
  encodeBase32(typeof input === "string" ? input : input.slice(), { alphabet })

export const decoder32 = (alphabet: Base32Alphabet, module: string) =>
(str: string): Result.Result<Uint8Array, EncodingError> =>
  attempt(module, "Decode", str, () => decodeBase32(str, { alphabet }))

export const stringDecoder = (decode: (str: string) => Result.Result<Uint8Array, EncodingError>) =>
(str: string): Result.Result<string, EncodingError> => Result.map(decode(str), (bytes) => decoder.decode(bytes))
