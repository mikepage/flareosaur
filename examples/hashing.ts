/**
 * @title Hashing
 * @difficulty beginner
 * @tags workers, crypto
 * @group Cryptography
 * @resource {https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest} MDN: SubtleCrypto.digest
 * @check GET / -> 200 "SHA-256: ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" "BLAKE3: 6437b3ac38465133ffb63b75273a8db548c558465d79db03fd359c6cd5bd9d85" "streamed SHA-256 matches: true"
 *
 * Web Crypto covers the SHA family. `@mikepage/flareosaur/crypto` adds the
 * rest of std's algorithms (BLAKE3, SHA-3, Keccak, MD5, FNV, ...), running
 * as WebAssembly that Workers load as a module, and `digestStream` hashes a
 * `Stream` chunk by chunk, so a large R2 object never has to be in memory.
 */

import { Console, Effect, Stream } from "effect"
import { Hex } from "effect/encoding"
import { digest, digestStream } from "@mikepage/flareosaur/crypto"
import { script } from "./_lib/script.ts"

const program = Effect.gen(function*() {
  const data = new TextEncoder().encode("abc")

  // SHA-256 goes to crypto.subtle; BLAKE3 to the WebAssembly hasher.
  yield* Console.log(`SHA-256: ${Hex.encode(yield* digest(data, "SHA-256"))}`)
  yield* Console.log(`BLAKE3: ${Hex.encode(yield* digest(data, "BLAKE3"))}`)

  // Hash a stream of chunks incrementally.
  const chunks = Stream.make("a", "b", "c").pipe(Stream.encodeText)
  const streamed = yield* digestStream(chunks, "SHA-256")
  yield* Console.log(`streamed SHA-256 matches: ${Hex.encode(streamed) === Hex.encode(yield* digest(data, "SHA-256"))}`)
})

export default script(program)
