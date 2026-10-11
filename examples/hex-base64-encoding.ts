/**
 * @title Hex, base64, base32 and base58 encoding
 * @difficulty beginner
 * @tags workers, encoding
 * @group Data formats
 * @resource {https://www.rfc-editor.org/rfc/rfc4648} RFC 4648: base16, base32, base64
 * @check GET / -> 200 "hex: 48656c6c6f" "base64: SGVsbG8=" "base64url: SGVsbG8" "base32: JBSWY3DP" "base58: 9Ajdvzr" "decoded: Hello" "bad input: EncodingError"
 *
 * Binary data often has to travel as text: in URLs, JSON or headers.
 * Effect ships hex and base64; flareosaur adds std's base32, base58 and
 * ascii85 with the same shape. Encoding cannot fail; decoding returns a
 * `Result`, so bad input is a value to handle, not an exception.
 */

import { Console, Effect, Result } from "effect"
import { Base32, Base58, Base64, Base64Url, Hex } from "@mikepage/flareosaur/encoding"
import { script } from "./_lib/script.ts"

const program = Effect.gen(function*() {
  const bytes = new TextEncoder().encode("Hello")
  yield* Console.log(`hex: ${Hex.encode(bytes)}`)
  yield* Console.log(`base64: ${Base64.encode(bytes)}`)
  yield* Console.log(`base64url: ${Base64Url.encode(bytes)}`)
  yield* Console.log(`base32: ${Base32.encode(bytes)}`)
  yield* Console.log(`base58: ${Base58.encode(bytes)}`)

  yield* Console.log(`decoded: ${Result.getOrThrow(Base58.decodeString("9Ajdvzr"))}`)

  const bad = Base64.decode("not base64!")
  yield* Console.log(`bad input: ${Result.isFailure(bad) ? bad.failure._tag : "?"}`)
})

export default script(program)
