/**
 * @title AES encryption and decryption
 * @difficulty intermediate
 * @tags workers, crypto
 * @group Cryptography
 * @resource {https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/encrypt} MDN: SubtleCrypto.encrypt
 * @check GET / -> 200 "ciphertext: 42 bytes" "decrypted: attack at dawn" "tampered: CryptoError"
 *
 * AES-GCM encrypts and authenticates in one step: a ciphertext that was
 * changed fails to decrypt. The helpers generate a fresh nonce from the
 * Effect `Crypto` service for every message and put it in front of the
 * ciphertext, so the nonce never has to be stored separately.
 */

import { Console, Effect } from "effect"
import { decryptAesGcm, encryptAesGcm, generateAesGcmKey, WebCrypto } from "@mikepage/flareosaur/crypto"
import { script } from "./_lib/script.ts"

const program = Effect.gen(function*() {
  const key = yield* generateAesGcmKey(256)

  const ciphertext = yield* encryptAesGcm(key, "attack at dawn")
  // 12-byte nonce + 14-byte message + 16-byte authentication tag = 42 bytes
  yield* Console.log(`ciphertext: ${ciphertext.length} bytes`)

  const plaintext = yield* decryptAesGcm(key, ciphertext)
  yield* Console.log(`decrypted: ${new TextDecoder().decode(plaintext)}`)

  // Flip one byte: authentication fails with a typed error.
  const tampered = ciphertext.slice()
  tampered[tampered.length - 1]! ^= 1
  const error = yield* Effect.flip(decryptAesGcm(key, tampered))
  yield* Console.log(`tampered: ${error._tag}`)
}).pipe(Effect.provide(WebCrypto.layer))

export default script(program)
