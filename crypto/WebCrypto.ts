// Copyright 2026 the flareosaur authors. MIT license.

/**
 * Effect's `Crypto` service, implemented with the Web Crypto API.
 *
 * `effect` defines the {@linkcode Crypto.Crypto} service (secure random
 * bytes, numbers, UUIDs, ULIDs and SHA digests) but ships no implementation
 * for Workers. {@linkcode layer} provides one backed by
 * `crypto.getRandomValues` and `crypto.subtle.digest`, which Cloudflare
 * Workers support without `nodejs_compat`.
 *
 * ```ts
 * import { Crypto, Effect } from "effect"
 * import * as WebCrypto from "@mikepage/flareosaur/crypto/web-crypto"
 *
 * const program = Effect.gen(function*() {
 *   const crypto = yield* Crypto.Crypto
 *   const id = yield* crypto.randomUUIDv4
 *   const hash = yield* crypto.digest("SHA-256", new TextEncoder().encode(id))
 *   return hash.length // 32
 * })
 *
 * Effect.runPromise(program.pipe(Effect.provide(WebCrypto.layer)))
 * ```
 *
 * @module
 */

import { Crypto, Effect, Layer, PlatformError } from "effect"

// crypto.getRandomValues fills at most 65536 bytes per call.
const MAX_RANDOM_CHUNK = 65536

const randomBytes = (size: number): Uint8Array => {
  const bytes = new Uint8Array(size)
  for (let offset = 0; offset < size; offset += MAX_RANDOM_CHUNK) {
    globalThis.crypto.getRandomValues(bytes.subarray(offset, Math.min(offset + MAX_RANDOM_CHUNK, size)))
  }
  return bytes
}

const toArrayBufferView = (data: Uint8Array): Uint8Array<ArrayBuffer> =>
  data.buffer instanceof ArrayBuffer ? data as Uint8Array<ArrayBuffer> : new Uint8Array(data)

const digest = (algorithm: Crypto.DigestAlgorithm, data: Uint8Array) =>
  Effect.tryPromise({
    try: async () => new Uint8Array(await globalThis.crypto.subtle.digest(algorithm, toArrayBufferView(data))),
    catch: (cause) =>
      PlatformError.systemError({
        _tag: "Unknown",
        module: "Crypto",
        method: "digest",
        description: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  })

/** A {@linkcode Crypto.Crypto} service backed by the Web Crypto API. */
export const make = (): Crypto.Crypto => Crypto.make({ randomBytes, digest })

/** Provides {@linkcode Crypto.Crypto} with the Web Crypto API. */
export const layer: Layer.Layer<Crypto.Crypto> = Layer.sync(Crypto.Crypto, make)
