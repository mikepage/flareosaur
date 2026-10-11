// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * Ascii85 (base85), from `@std/encoding`, in the style of
 * `effect/encoding/Base64`, in four standards: Adobe (the default, with the
 * optional `<~ ~>` delimiters), btoa, RFC 1924 and Z85.
 *
 * `decode` returns a `Result` that fails with Effect's `EncodingError`.
 *
 * ```ts
 * import * as Ascii85 from "@mikepage/flareosaur/encoding/ascii85"
 *
 * Ascii85.encode("Hello world!") // "87cURD]j7BEbo80"
 * Ascii85.encode("Hello world!", { standard: "Z85" }) // "nm=QNzY<mxA+]nf"
 * Ascii85.decodeString("87cURD]j7BEbo80") // Result.succeed("Hello world!")
 * ```
 *
 * @module
 */

import { Result } from "effect"
import type { EncodingError } from "effect/encoding/EncodingError"
import {
  type Ascii85Standard,
  decodeAscii85,
  type DecodeAscii85Options,
  encodeAscii85,
  type EncodeAscii85Options,
} from "./_std/ascii85.ts"
import { attempt } from "./_shared.ts"

export type { Ascii85Standard, DecodeAscii85Options as DecodeOptions, EncodeAscii85Options as EncodeOptions }

const textDecoder = new TextDecoder()

/** Encodes bytes, or a string as UTF-8, as Ascii85 in the given standard (Adobe by default). */
export const encode = (input: Uint8Array | string, options?: EncodeAscii85Options): string =>
  encodeAscii85(input, options)

/**
 * Decodes Ascii85 in the given standard (Adobe by default) into bytes.
 * Fails with an `EncodingError` on a character outside the standard's
 * alphabet.
 */
export const decode = (str: string, options?: DecodeAscii85Options): Result.Result<Uint8Array, EncodingError> =>
  attempt("Ascii85", "Decode", str, () => {
    // std skips characters outside the alphabet; reject them instead.
    const standard = options?.standard ?? "Adobe"
    const { delimiters, chars } = alphabets[standard]
    const body = (delimiters ? str.replace(delimiters, "") : str).replace(/\s/g, "")
    for (let i = 0; i < body.length; i++) {
      if (!chars.test(body[i]!)) {
        throw new TypeError(`Invalid ${standard} ascii85 character at index ${i}: ${JSON.stringify(body[i])}`)
      }
    }
    const groups = standard === "Adobe" || standard === "btoa" ? body.replace(/[zy]/g, "") : body
    if (groups.length % 5 === 1) throw new TypeError("Invalid ascii85 length: a final group of one character")
    return decodeAscii85(str, options)
  })

const alphabets: Record<Ascii85Standard, { readonly delimiters?: RegExp; readonly chars: RegExp }> = {
  Adobe: { delimiters: /^<~|~>$/g, chars: /[!-uz]/ },
  btoa: { delimiters: /^xbtoa Begin|xbtoa End$/g, chars: /[!-uzy]/ },
  "RFC 1924": { chars: /[0-9A-Za-z!#$%&()*+\-;<=>?@^_`{|}~]/ },
  Z85: { chars: /[0-9a-zA-Z.\-:+=^!/*?&<>()[\]{}@%$#]/ },
}

/** Decodes Ascii85 into a UTF-8 string. */
export const decodeString = (str: string, options?: DecodeAscii85Options): Result.Result<string, EncodingError> =>
  Result.map(decode(str, options), (bytes) => textDecoder.decode(bytes))
