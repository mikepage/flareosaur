// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * Hashing, authenticated encryption, MACs and key derivation, as Effects.
 *
 * Effect's `Crypto` service covers random values and the four Web Crypto SHA
 * digests. This module adds what `@std/crypto` offers on top:
 *
 * - {@linkcode digest} and {@linkcode digestStream}: every algorithm of
 *   std's bundled Wasm hasher (BLAKE3, BLAKE2, SHA-3, Keccak, SHAKE, MD5,
 *   FNV, ...) next to the Web Crypto SHA family, over bytes or a
 *   `Stream<Uint8Array>`.
 * - {@linkcode timingSafeEqual} for comparing secrets.
 * - AES-GCM encryption in std's wire format (`nonce || ciphertext || tag`),
 *   HMAC signing and verification, PBKDF2 and HKDF.
 *
 * Failures are a typed {@linkcode CryptoError}; secret key material goes in
 * and out as `Redacted`. Randomness (AES-GCM nonces) comes from Effect's
 * `Crypto` service; provide it with {@linkcode WebCrypto.layer}.
 *
 * ```ts
 * import { Effect, Redacted } from "effect"
 * import * as Hex from "effect/encoding/Hex"
 * import * as Crypto from "@mikepage/flareosaur/crypto"
 *
 * const program = Effect.gen(function*() {
 *   const hash = yield* Crypto.digest("abc", "BLAKE3")
 *   const key = yield* Crypto.importAesGcmKey(Redacted.make(new Uint8Array(32)))
 *   const sealed = yield* Crypto.encryptAesGcm(key, "secret")
 *   const opened = yield* Crypto.decryptAesGcm(key, sealed)
 *   return [Hex.encode(hash), new TextDecoder().decode(opened)]
 * })
 *
 * Effect.runPromise(program.pipe(Effect.provide(Crypto.WebCrypto.layer)))
 * ```
 *
 * @module
 */

import { type Cause, type Crypto as EffectCrypto, Crypto as CryptoService, Effect, Function, Redacted, Schema, Stream } from "effect"
import { decryptAesGcm as stdDecryptAesGcm } from "./_std/aes_gcm.ts"
import { DIGEST_ALGORITHM_NAMES, type DigestAlgorithmName, DigestContext, digest as wasmDigest } from "./_std/_wasm/mod.ts"
import * as WebCrypto from "./WebCrypto.ts"

export { WebCrypto }

const CryptoErrorBase: Schema.Class<
  CryptoError,
  Schema.TaggedStruct<"CryptoError", {
    readonly operation: Schema.String
    readonly message: Schema.String
    readonly cause: Schema.Defect
  }>,
  Cause.YieldableError
> = Schema.TaggedError<CryptoError>()("CryptoError", {
  operation: Schema.String,
  message: Schema.String,
  cause: Schema.Defect(),
})

/** A cryptographic operation failed: bad input, an unsupported algorithm, or a rejected key or tag. */
export class CryptoError extends CryptoErrorBase {}

const cryptoError = (operation: string) => (cause: unknown) =>
  new CryptoError({
    operation,
    message: cause instanceof Error ? cause.message || cause.name : String(cause),
    cause,
  })

/** Input bytes. Strings are encoded as UTF-8. */
export type Data = Uint8Array | string

/** Secret key material. Strings are encoded as UTF-8. */
export type Secret = Redacted.Redacted<Uint8Array> | Redacted.Redacted<string>

const encoder = new TextEncoder()

const toBytes = (data: Data): Uint8Array<ArrayBuffer> => {
  if (typeof data === "string") return encoder.encode(data)
  return data.buffer instanceof ArrayBuffer ? data as Uint8Array<ArrayBuffer> : new Uint8Array(data)
}

const secretBytes = (secret: Secret): Uint8Array<ArrayBuffer> => toBytes(Redacted.value<Data>(secret))

// ---------------------------------------------------------------------------
// Digests
// ---------------------------------------------------------------------------

/** Every digest algorithm {@linkcode digest} supports. */
export const DIGEST_ALGORITHMS: ReadonlyArray<DigestAlgorithm> = DIGEST_ALGORITHM_NAMES

/** A digest algorithm: the Web Crypto SHA family or one of std's Wasm algorithms. */
export type DigestAlgorithm = DigestAlgorithmName

/** Options for {@linkcode digest} and {@linkcode digestStream}. */
export interface DigestOptions {
  /** Output length in bytes, for variable-length algorithms (BLAKE3, SHAKE). */
  readonly length?: number | undefined
}

const WEB_CRYPTO_DIGESTS: ReadonlySet<string> = new Set(["SHA-1", "SHA-256", "SHA-384", "SHA-512"])

/** Whether `name` is a supported digest algorithm (case-insensitive). */
export const isDigestAlgorithm = (name: string): name is DigestAlgorithm =>
  (DIGEST_ALGORITHM_NAMES as ReadonlyArray<string>).includes(name.toUpperCase())

const normalize = (algorithm: DigestAlgorithm): DigestAlgorithm => algorithm.toUpperCase() as DigestAlgorithm

/**
 * Hashes `data`. The SHA family goes through `crypto.subtle`; the other
 * algorithms (and any explicit output `length`) through std's Wasm hasher.
 *
 * ```ts
 * import { Effect } from "effect"
 * import * as Hex from "effect/encoding/Hex"
 * import { digest } from "@mikepage/flareosaur/crypto"
 *
 * Effect.runSync(digest("abc", "BLAKE3").pipe(Effect.map(Hex.encode)))
 * // "6437b3ac38465133ffb63b75273a8db548c558465d79db03fd359c6cd5bd9d85"
 * ```
 */
export const digest: {
  (algorithm: DigestAlgorithm, options?: DigestOptions): (data: Data) => Effect.Effect<Uint8Array, CryptoError>
  (data: Data, algorithm: DigestAlgorithm, options?: DigestOptions): Effect.Effect<Uint8Array, CryptoError>
} = Function.dual(
  (args) => typeof args[1] === "string",
  (data: Data, algorithm: DigestAlgorithm, options?: DigestOptions): Effect.Effect<Uint8Array, CryptoError> => {
    const name = normalize(algorithm)
    const bytes = toBytes(data)
    if (WEB_CRYPTO_DIGESTS.has(name) && options?.length === undefined) {
      return Effect.tryPromise({
        try: async () => new Uint8Array(await globalThis.crypto.subtle.digest(name, bytes)),
        catch: cryptoError("digest"),
      })
    }
    return Effect.try({ try: () => wasmDigest(name, bytes, options?.length), catch: cryptoError("digest") })
  },
)

/**
 * Hashes a stream of byte chunks incrementally with std's Wasm hasher,
 * without buffering the whole input. Supports every
 * {@linkcode DigestAlgorithm}, the SHA family included.
 */
export const digestStream: {
  (
    algorithm: DigestAlgorithm,
    options?: DigestOptions,
  ): <E, R>(stream: Stream.Stream<Uint8Array, E, R>) => Effect.Effect<Uint8Array, CryptoError | E, R>
  <E, R>(
    stream: Stream.Stream<Uint8Array, E, R>,
    algorithm: DigestAlgorithm,
    options?: DigestOptions,
  ): Effect.Effect<Uint8Array, CryptoError | E, R>
} = Function.dual(
  (args) => Stream.isStream(args[0]),
  <E, R>(
    stream: Stream.Stream<Uint8Array, E, R>,
    algorithm: DigestAlgorithm,
    options?: DigestOptions,
  ): Effect.Effect<Uint8Array, CryptoError | E, R> =>
    Effect.acquireUseRelease(
      Effect.try({ try: () => ({ context: new DigestContext(normalize(algorithm)), done: false }), catch: cryptoError("digest") }),
      (state) =>
        Stream.runForEach(stream, (chunk) =>
          Effect.try({ try: () => state.context.update(chunk), catch: cryptoError("digest") })).pipe(
            Effect.flatMap(() =>
              Effect.try({
                try: () => {
                  state.done = true
                  return state.context.digestAndDrop(options?.length)
                },
                catch: cryptoError("digest"),
              })
            ),
          ),
      (state) =>
        Effect.sync(() => {
          if (!state.done) state.context.free()
        }),
    ),
)

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/**
 * Compares two byte arrays in constant time (for equal lengths), for
 * checking secrets such as MACs or tokens. Arrays of different lengths are
 * not equal.
 */
export const timingSafeEqual: {
  (that: Uint8Array): (self: Uint8Array) => boolean
  (self: Uint8Array, that: Uint8Array): boolean
} = Function.dual(2, (self: Uint8Array, that: Uint8Array): boolean => {
  if (self.byteLength !== that.byteLength) return false
  let out = 0
  for (let i = 0; i < self.length; i++) out |= self[i]! ^ that[i]!
  return out === 0
})

// ---------------------------------------------------------------------------
// AES-GCM
// ---------------------------------------------------------------------------

const NONCE_LENGTH = 12
const TAG_LENGTH = 16

/** Options for {@linkcode encryptAesGcm} and {@linkcode decryptAesGcm}. */
export interface AesGcmOptions {
  /** Additional authenticated data: authenticated but not encrypted. */
  readonly additionalData?: Data | undefined
}

/** Generates a new extractable AES-GCM key. */
export const generateAesGcmKey = (length: 128 | 256 = 256): Effect.Effect<CryptoKey, CryptoError> =>
  Effect.tryPromise({
    try: () =>
      globalThis.crypto.subtle.generateKey({ name: "AES-GCM", length }, true, ["encrypt", "decrypt"]) as Promise<
        CryptoKey
      >,
    catch: cryptoError("generateKey"),
  })

/** Imports a raw 16- or 32-byte AES-GCM key. */
export const importAesGcmKey = (raw: Secret): Effect.Effect<CryptoKey, CryptoError> =>
  Effect.tryPromise({
    try: () => globalThis.crypto.subtle.importKey("raw", secretBytes(raw), { name: "AES-GCM" }, true, ["encrypt", "decrypt"]),
    catch: cryptoError("importKey"),
  })

/** Exports the raw bytes of an extractable secret key (AES or HMAC). */
export const exportKey = (key: CryptoKey): Effect.Effect<Redacted.Redacted<Uint8Array>, CryptoError> =>
  Effect.tryPromise({
    try: async () => Redacted.make(new Uint8Array(await globalThis.crypto.subtle.exportKey("raw", key) as ArrayBuffer)),
    catch: cryptoError("exportKey"),
  })

const aesParams = (iv: Uint8Array<ArrayBuffer>, options?: AesGcmOptions): AesGcmParams => {
  const params: AesGcmParams = { name: "AES-GCM", iv, tagLength: TAG_LENGTH * 8 }
  if (options?.additionalData !== undefined) params.additionalData = toBytes(options.additionalData)
  return params
}

/**
 * Encrypts with AES-GCM under a fresh random 96-bit nonce (from Effect's
 * `Crypto` service). The output is `nonce || ciphertext || tag`, the format
 * of std's `encryptAesGcm`, so it is 28 bytes longer than the plaintext.
 */
export const encryptAesGcm = (
  key: CryptoKey,
  plaintext: Data,
  options?: AesGcmOptions,
): Effect.Effect<Uint8Array, CryptoError, EffectCrypto.Crypto> =>
  Effect.gen(function*() {
    const crypto = yield* CryptoService.Crypto
    const nonce = new Uint8Array(yield* Effect.orDie(crypto.randomBytes(NONCE_LENGTH)))
    const sealed = yield* Effect.tryPromise({
      try: async () =>
        new Uint8Array(await globalThis.crypto.subtle.encrypt(aesParams(nonce, options), key, toBytes(plaintext))),
      catch: cryptoError("encrypt"),
    })
    const result = new Uint8Array(NONCE_LENGTH + sealed.byteLength)
    result.set(nonce)
    result.set(sealed, NONCE_LENGTH)
    return result
  })

/**
 * Decrypts the output of {@linkcode encryptAesGcm} (or std's
 * `encryptAesGcm`). Fails when the data is too short, or the key, tag or
 * additional data do not match.
 */
export const decryptAesGcm = (
  key: CryptoKey,
  data: Uint8Array,
  options?: AesGcmOptions,
): Effect.Effect<Uint8Array, CryptoError> =>
  Effect.tryPromise({
    try: () =>
      stdDecryptAesGcm(
        key,
        toBytes(data),
        options?.additionalData === undefined ? undefined : { additionalData: toBytes(options.additionalData) },
      ),
    catch: cryptoError("decrypt"),
  })

// ---------------------------------------------------------------------------
// HMAC
// ---------------------------------------------------------------------------

/** A hash for HMAC, PBKDF2 and HKDF: one of the Web Crypto SHA algorithms. */
export type HashAlgorithm = EffectCrypto.DigestAlgorithm

/** An HMAC key: an imported `CryptoKey`, or raw secret bytes. */
export type HmacKey = CryptoKey | Secret

/** Options for the HMAC functions. */
export interface HmacOptions {
  /** The hash function. Defaults to `"SHA-256"`. Ignored for a `CryptoKey`. */
  readonly hash?: HashAlgorithm | undefined
}

/** Imports raw secret bytes as an HMAC key for signing and verifying. */
export const importHmacKey = (secret: Secret, options?: HmacOptions): Effect.Effect<CryptoKey, CryptoError> =>
  Effect.tryPromise({
    try: () =>
      globalThis.crypto.subtle.importKey(
        "raw",
        secretBytes(secret),
        { name: "HMAC", hash: options?.hash ?? "SHA-256" },
        true,
        ["sign", "verify"],
      ),
    catch: cryptoError("importKey"),
  })

const hmacKey = (key: HmacKey, options?: HmacOptions): Effect.Effect<CryptoKey, CryptoError> =>
  Redacted.isRedacted(key) ? importHmacKey(key, options) : Effect.succeed(key)

/** Computes the HMAC of `data`. */
export const hmacSign = (key: HmacKey, data: Data, options?: HmacOptions): Effect.Effect<Uint8Array, CryptoError> =>
  Effect.flatMap(hmacKey(key, options), (cryptoKey) =>
    Effect.tryPromise({
      try: async () => new Uint8Array(await globalThis.crypto.subtle.sign("HMAC", cryptoKey, toBytes(data))),
      catch: cryptoError("sign"),
    }))

/** Checks an HMAC signature of `data`, in constant time. */
export const hmacVerify = (
  key: HmacKey,
  data: Data,
  signature: Uint8Array,
  options?: HmacOptions,
): Effect.Effect<boolean, CryptoError> =>
  Effect.flatMap(hmacKey(key, options), (cryptoKey) =>
    Effect.tryPromise({
      try: () => globalThis.crypto.subtle.verify("HMAC", cryptoKey, toBytes(signature), toBytes(data)),
      catch: cryptoError("verify"),
    }))

// ---------------------------------------------------------------------------
// Key derivation
// ---------------------------------------------------------------------------

/** Options for {@linkcode pbkdf2}. */
export interface Pbkdf2Options {
  readonly salt: Data
  readonly iterations: number
  /** Defaults to `"SHA-256"`. */
  readonly hash?: HashAlgorithm | undefined
  /** Derived key length in bytes. Defaults to 32. */
  readonly length?: number | undefined
}

const deriveBits = (
  operation: string,
  algorithm: "PBKDF2" | "HKDF",
  secret: Secret,
  params: Pbkdf2Params | HkdfParams,
  length: number,
): Effect.Effect<Redacted.Redacted<Uint8Array>, CryptoError> =>
  Effect.tryPromise({
    try: async () => {
      const base = await globalThis.crypto.subtle.importKey("raw", secretBytes(secret), algorithm, false, ["deriveBits"])
      return Redacted.make(new Uint8Array(await globalThis.crypto.subtle.deriveBits(params, base, length * 8)))
    },
    catch: cryptoError(operation),
  })

/** Derives key bytes from a password with PBKDF2. */
export const pbkdf2 = (password: Secret, options: Pbkdf2Options): Effect.Effect<Redacted.Redacted<Uint8Array>, CryptoError> =>
  deriveBits(
    "pbkdf2",
    "PBKDF2",
    password,
    { name: "PBKDF2", salt: toBytes(options.salt), iterations: options.iterations, hash: options.hash ?? "SHA-256" },
    options.length ?? 32,
  )

/** Options for {@linkcode hkdf}. */
export interface HkdfOptions {
  /** Defaults to empty. */
  readonly salt?: Data | undefined
  /** Context and application specific information. Defaults to empty. */
  readonly info?: Data | undefined
  /** Defaults to `"SHA-256"`. */
  readonly hash?: HashAlgorithm | undefined
  /** Derived key length in bytes. Defaults to 32. */
  readonly length?: number | undefined
}

/** Derives key bytes from input key material with HKDF (RFC 5869). */
export const hkdf = (keyMaterial: Secret, options?: HkdfOptions): Effect.Effect<Redacted.Redacted<Uint8Array>, CryptoError> =>
  deriveBits(
    "hkdf",
    "HKDF",
    keyMaterial,
    {
      name: "HKDF",
      salt: toBytes(options?.salt ?? new Uint8Array()),
      info: toBytes(options?.info ?? new Uint8Array()),
      hash: options?.hash ?? "SHA-256",
    },
    options?.length ?? 32,
  )
