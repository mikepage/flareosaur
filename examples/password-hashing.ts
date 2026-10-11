/**
 * @title Hashing and verifying passwords
 * @difficulty intermediate
 * @tags workers, crypto, security
 * @group Cryptography
 * @resource {https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveBits} MDN: SubtleCrypto.deriveBits
 * @resource {https://jsr.io/@std/crypto/doc/~/timingSafeEqual} @std/crypto: timingSafeEqual
 * @resource {https://jsr.io/@std/encoding} @std/encoding
 * @check GET / -> 200 "stored: pbkdf2$100000$" "correct password: true" "wrong password: false"
 *
 * Passwords must never be stored in plain text, or hashed with a fast hash.
 * PBKDF2 (in Web Crypto on Workers) stretches a password with a random salt
 * and many iterations. Store the salt and iteration count with the hash, and
 * compare in constant time when a user logs in.
 */

import { timingSafeEqual } from "@mikepage/flareosaur/crypto/timing-safe-equal";
import {
  decodeBase64,
  encodeBase64,
} from "@mikepage/flareosaur/encoding/base64";
import { script } from "./_lib/script.ts";

// Workers cap PBKDF2 at 100,000 iterations.
const ITERATIONS = 100_000;

// PBKDF2-SHA-256: the password becomes a key, and deriveBits stretches it.
async function derive(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    key,
    256,
  );
  return new Uint8Array(bits);
}

// "pbkdf2$<iterations>$<salt>$<hash>", all a database column needs.
async function hash(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derived = await derive(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${encodeBase64(salt)}$${encodeBase64(derived)}`;
}

async function verify(password: string, stored: string): Promise<boolean> {
  const [scheme, iterations, salt, expected] = stored.split("$");
  if (scheme !== "pbkdf2" || !iterations || !salt || !expected) return false;
  const expectedBytes = decodeBase64(expected);
  const derived = await derive(
    password,
    decodeBase64(salt),
    Number(iterations),
  );
  // A plain === would return at the first different byte, and the time it
  // takes leaks how much of the hash matched. timingSafeEqual always reads
  // every byte.
  return derived.length === expectedBytes.length &&
    timingSafeEqual(derived, expectedBytes);
}

export default script(async (print) => {
  const stored = await hash("correct horse battery staple");
  print(`stored: ${stored.slice(0, 30)}...`);
  print(
    "correct password:",
    String(await verify("correct horse battery staple", stored)),
  );
  print("wrong password:", String(await verify("hunter2", stored)));
});
