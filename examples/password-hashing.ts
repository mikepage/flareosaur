/**
 * @title Hashing and verifying passwords
 * @difficulty intermediate
 * @tags workers, crypto, security
 * @group Cryptography
 * @resource {https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveBits} MDN: SubtleCrypto.deriveBits
 * @check GET / -> 200 "stored: pbkdf2$100000$" "correct password: true" "wrong password: false"
 *
 * Passwords must never be stored in plain text, or hashed with a fast hash.
 * PBKDF2 (available in Web Crypto on Workers) stretches a password with a
 * random salt and many iterations. Store the salt and iteration count with
 * the hash, and compare in constant time when a user logs in.
 */

import { Console, Crypto, Effect, Redacted } from "effect"
import { Base64 } from "effect/encoding"
import { pbkdf2, timingSafeEqual, WebCrypto } from "@mikepage/flareosaur/crypto"
import { script } from "./_lib/script.ts"

const ITERATIONS = 100_000

const derive = (password: string, salt: Uint8Array, iterations: number) =>
  Effect.map(
    pbkdf2(Redacted.make(password), { salt, iterations, hash: "SHA-256", length: 32 }),
    Redacted.value,
  )

// "pbkdf2$<iterations>$<salt>$<hash>", all a database column needs.
const hash = (password: string) =>
  Effect.gen(function*() {
    const crypto = yield* Crypto.Crypto
    const salt = yield* Effect.orDie(crypto.randomBytes(16))
    const derived = yield* derive(password, salt, ITERATIONS)
    return `pbkdf2$${ITERATIONS}$${Base64.encode(salt)}$${Base64.encode(derived)}`
  })

const verify = (password: string, stored: string) =>
  Effect.gen(function*() {
    const [, iterations, salt, expected] = stored.split("$")
    const saltBytes = Base64.decode(salt!)
    const expectedBytes = Base64.decode(expected!)
    if (saltBytes._tag === "Failure" || expectedBytes._tag === "Failure") return false
    const derived = yield* derive(password, saltBytes.success, Number(iterations))
    return timingSafeEqual(derived, expectedBytes.success)
  })

const program = Effect.gen(function*() {
  const stored = yield* hash("correct horse battery staple")
  yield* Console.log(`stored: ${stored.slice(0, 30)}...`)
  yield* Console.log(`correct password: ${yield* verify("correct horse battery staple", stored)}`)
  yield* Console.log(`wrong password: ${yield* verify("hunter2", stored)}`)
}).pipe(Effect.provide(WebCrypto.layer))

export default script(program)
