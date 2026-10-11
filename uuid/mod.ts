// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * UUID generation (v1, v3, v4, v5, v6, v7), validation and Schemas.
 *
 * Effect's `Crypto` service generates v4 and v7 UUIDs and Effect Schema
 * validates them (`Schema.isUUID`). This module adds the rest of
 * `@std/uuid`: time-based v1 and v6, name-based v3 (MD5) and v5 (SHA-1),
 * version detection and timestamp extraction, plus a branded
 * {@linkcode Uuid} Schema with per-version variants.
 *
 * Generators are Effects: time comes from Effect's `Clock` and randomness
 * from Effect's `Crypto` service, so tests can pin both (`TestClock`, a fixed
 * `Crypto`). In production provide `WebCrypto.layer` from
 * `@mikepage/flareosaur/crypto`.
 *
 * ```ts
 * import { Effect } from "effect"
 * import * as Uuid from "@mikepage/flareosaur/uuid"
 * import { WebCrypto } from "@mikepage/flareosaur/crypto"
 *
 * const program = Effect.gen(function*() {
 *   const id = yield* Uuid.v7()
 *   const named = yield* Uuid.v5(Uuid.NAMESPACE_URL, "https://deno.land/")
 *   return [Uuid.version(id), named] // [Option.some(7), "..."]
 * })
 *
 * Effect.runPromise(program.pipe(Effect.provide(WebCrypto.layer)))
 * ```
 *
 * @module
 */

import { type Brand, Crypto, DateTime, Effect, Option, Result, Schema } from "effect"
import { digest } from "../crypto/mod.ts"
import { bytesToUuid, uuidToBytes } from "./_std/_common.ts"
import { generate as stdV1 } from "./_std/v1.ts"
import { generate as stdV6 } from "./_std/unstable_v6.ts"

/** A UUID could not be generated, or a string is not a valid UUID. */
export class UuidError extends Schema.TaggedError<UuidError>()("UuidError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

const uuidError = (cause: unknown) =>
  new UuidError({ message: cause instanceof Error ? cause.message : String(cause), cause })

// ---------------------------------------------------------------------------
// Schemas and validation
// ---------------------------------------------------------------------------

/** A string validated as a UUID. */
export type Uuid = string & Brand.Brand<"Uuid">

/**
 * A UUID string: versions 1 to 8 in the RFC 9562 variant, or the nil or max
 * UUID. Built on Effect's `Schema.isUUID`; case-insensitive.
 */
export const Uuid = Schema.String.pipe(Schema.check(Schema.isUUID()), Schema.brand("Uuid"))

/** A UUID version that {@linkcode schemaVersion} accepts. */
export type Version = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

/** A UUID Schema accepting only the given version (nil and max excluded). */
export const schemaVersion = (version: Version) =>
  Schema.String.pipe(Schema.check(Schema.isUUID(version)), Schema.brand("Uuid"))

/** A version 1 UUID (time-based). */
export const UuidV1 = schemaVersion(1)
/** A version 3 UUID (name-based, MD5). */
export const UuidV3 = schemaVersion(3)
/** A version 4 UUID (random). */
export const UuidV4 = schemaVersion(4)
/** A version 5 UUID (name-based, SHA-1). */
export const UuidV5 = schemaVersion(5)
/** A version 6 UUID (time-based, sortable). */
export const UuidV6 = schemaVersion(6)
/** A version 7 UUID (Unix time-based, sortable). */
export const UuidV7 = schemaVersion(7)

/** The nil UUID: all bits zero. */
export const NIL = "00000000-0000-0000-0000-000000000000" as Uuid
/** The max UUID: all bits one. */
export const MAX = "ffffffff-ffff-ffff-ffff-ffffffffffff" as Uuid
/** Namespace for v3/v5 UUIDs of fully qualified domain names. */
export const NAMESPACE_DNS = "6ba7b810-9dad-11d1-80b4-00c04fd430c8" as Uuid
/** Namespace for v3/v5 UUIDs of URLs. */
export const NAMESPACE_URL = "6ba7b811-9dad-11d1-80b4-00c04fd430c8" as Uuid
/** Namespace for v3/v5 UUIDs of ISO OIDs. */
export const NAMESPACE_OID = "6ba7b812-9dad-11d1-80b4-00c04fd430c8" as Uuid
/** Namespace for v3/v5 UUIDs of X.500 distinguished names. */
export const NAMESPACE_X500 = "6ba7b814-9dad-11d1-80b4-00c04fd430c8" as Uuid

const isUuidSchema = Schema.is(Uuid)

/** Whether `input` is a valid UUID (any version, nil or max). */
export const isUuid = (input: unknown): input is Uuid => isUuidSchema(input)

/** Whether `uuid` is the nil UUID. */
export const isNil = (uuid: string): boolean => uuid === NIL

/** Whether `uuid` is the max UUID (case-insensitive). */
export const isMax = (uuid: string): boolean => uuid.toLowerCase() === MAX

/** The version of a UUID; `None` for invalid input and for the nil and max UUIDs. */
export const version = (uuid: string): Option.Option<Version> =>
  isUuid(uuid) && !isNil(uuid) && !isMax(uuid) ? Option.some(parseInt(uuid[14]!, 16) as Version) : Option.none()

/** Parses a UUID string into its 16 bytes. */
export const toBytes = (uuid: string): Result.Result<Uint8Array, UuidError> =>
  isUuid(uuid) ? Result.succeed(uuidToBytes(uuid)) : Result.fail(new UuidError({ message: `Invalid UUID: ${uuid}` }))

/** Formats 16 bytes as a lowercase UUID string, without checking version bits. */
export const fromBytes = (bytes: Uint8Array): Result.Result<string, UuidError> =>
  bytes.length === 16
    ? Result.succeed(bytesToUuid(bytes))
    : Result.fail(new UuidError({ message: `A UUID has 16 bytes, got ${bytes.length}` }))

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const randomBytes = (size: number): Effect.Effect<Uint8Array, never, Crypto.Crypto> =>
  Effect.gen(function*() {
    const crypto = yield* Crypto.Crypto
    return yield* Effect.orDie(crypto.randomBytes(size))
  })

const millis = (timestamp: DateTime.DateTime | number | undefined): Effect.Effect<number> =>
  timestamp === undefined
    ? Effect.clockWith((clock) => Effect.succeed(clock.currentTimeMillisUnsafe()))
    : Effect.succeed(typeof timestamp === "number" ? timestamp : DateTime.toEpochMillis(timestamp))

/** Options for the time-based {@linkcode v1} and {@linkcode v6}. */
export interface TimeBasedOptions {
  /** 6 bytes of node ID (an IEEE 802 MAC address). Random by default. */
  readonly node?: ReadonlyArray<number> | undefined
  /** A 14-bit clock sequence (0 - 16383). Random by default. */
  readonly clockseq?: number | undefined
  /** The time, as a `DateTime` or epoch milliseconds. The `Clock` by default. */
  readonly timestamp?: DateTime.DateTime | number | undefined
  /** 100-nanosecond intervals to add to the timestamp (0 - 9999). Defaults to 0. */
  readonly nsecs?: number | undefined
}

const timeBased = (
  generate: typeof stdV1,
  multicast: boolean,
  options: TimeBasedOptions | undefined,
): Effect.Effect<Uuid, UuidError, Crypto.Crypto> =>
  Effect.gen(function*() {
    const seed = options?.node === undefined || options.clockseq === undefined ? yield* randomBytes(8) : undefined
    const node = options?.node !== undefined
      ? [...options.node]
      : [multicast ? seed![0]! | 0x01 : seed![0]!, seed![1]!, seed![2]!, seed![3]!, seed![4]!, seed![5]!]
    const clockseq = options?.clockseq ?? ((seed![6]! << 8) | seed![7]!) & 0x3fff
    const msecs = yield* millis(options?.timestamp)
    // Every input is explicit, so std's module-level state does not leak in.
    return yield* Effect.try({
      try: () => generate({ node, clockseq, msecs, nsecs: options?.nsecs ?? 0 }) as Uuid,
      catch: uuidError,
    })
  })

/**
 * Generates a version 1 (time-based) UUID. The node ID and clock sequence
 * are random unless given; the time comes from the `Clock`.
 */
export const v1 = (options?: TimeBasedOptions): Effect.Effect<Uuid, UuidError, Crypto.Crypto> =>
  timeBased(stdV1, true, options)

/**
 * Generates a version 6 UUID: the fields of v1, reordered so that the UUIDs
 * sort by time.
 */
export const v6 = (options?: TimeBasedOptions): Effect.Effect<Uuid, UuidError, Crypto.Crypto> =>
  timeBased(stdV6, false, options)

/** Generates a version 4 (random) UUID with Effect's `Crypto` service. */
export const v4: Effect.Effect<Uuid, never, Crypto.Crypto> = Effect.gen(function*() {
  const crypto = yield* Crypto.Crypto
  return (yield* Effect.orDie(crypto.randomUUIDv4)) as Uuid
})

/** Options for {@linkcode v7}. */
export interface V7Options {
  /** The time, as a `DateTime` or epoch milliseconds. The `Clock` by default. */
  readonly timestamp?: DateTime.DateTime | number | undefined
}

/**
 * Generates a version 7 UUID: a 48-bit Unix millisecond timestamp followed by
 * random bits, so the UUIDs sort by creation time.
 */
export const v7 = (options?: V7Options): Effect.Effect<Uuid, UuidError, Crypto.Crypto> =>
  Effect.gen(function*() {
    const timestamp = yield* millis(options?.timestamp)
    if (!Number.isInteger(timestamp) || timestamp < 0 || timestamp > 2 ** 48 - 1) {
      return yield* new UuidError({
        message: `Cannot generate UUID as timestamp must be an integer between 0 and 2**48 - 1: timestamp ${timestamp}`,
      })
    }
    const bytes = new Uint8Array(yield* randomBytes(16))
    const view = new DataView(bytes.buffer)
    view.setUint16(0, Math.floor(timestamp / 2 ** 32))
    view.setUint32(2, timestamp % 2 ** 32)
    bytes[6] = (bytes[6]! & 0x0f) | 0x70
    bytes[8] = (bytes[8]! & 0x3f) | 0x80
    return bytesToUuid(bytes) as Uuid
  })

const encoder = new TextEncoder()

const nameBased = (
  namespace: string,
  name: Uint8Array | string,
  algorithm: "MD5" | "SHA-1",
  versionBits: number,
): Effect.Effect<Uuid, UuidError> =>
  Effect.gen(function*() {
    if (!isUuid(namespace)) return yield* new UuidError({ message: `Cannot generate UUID: invalid namespace ${namespace}` })
    const nameBytes = typeof name === "string" ? encoder.encode(name) : name
    const input = new Uint8Array(16 + nameBytes.length)
    input.set(uuidToBytes(namespace))
    input.set(nameBytes, 16)
    const hash = yield* digest(input, algorithm).pipe(Effect.mapError(uuidError))
    const bytes = hash.slice(0, 16)
    bytes[6] = (bytes[6]! & 0x0f) | versionBits
    bytes[8] = (bytes[8]! & 0x3f) | 0x80
    return bytesToUuid(bytes) as Uuid
  })

/** Generates a version 3 UUID: the MD5 hash of a namespace UUID and a name. Strings are UTF-8 encoded. */
export const v3 = (namespace: string, name: Uint8Array | string): Effect.Effect<Uuid, UuidError> =>
  nameBased(namespace, name, "MD5", 0x30)

/** Generates a version 5 UUID: the SHA-1 hash of a namespace UUID and a name. Strings are UTF-8 encoded. */
export const v5 = (namespace: string, name: Uint8Array | string): Effect.Effect<Uuid, UuidError> =>
  nameBased(namespace, name, "SHA-1", 0x50)

// ---------------------------------------------------------------------------
// Timestamps
// ---------------------------------------------------------------------------

// 100-nanosecond intervals between the Gregorian epoch (1582-10-15) and 1970.
const GREGORIAN_OFFSET = 122192928000000000n

/**
 * The creation time embedded in a v1, v6 or v7 UUID. Fails for other
 * versions and for invalid input.
 */
export const extractTimestamp = (uuid: string): Result.Result<DateTime.Utc, UuidError> => {
  const hex = uuid.replaceAll("-", "")
  let ms: number
  switch (Option.getOrUndefined(version(uuid))) {
    case 1: {
      const ticks = BigInt(`0x${hex.slice(13, 16)}${hex.slice(8, 12)}${hex.slice(0, 8)}`)
      ms = Number((ticks - GREGORIAN_OFFSET) / 10000n)
      break
    }
    case 6: {
      const ticks = BigInt(`0x${hex.slice(0, 8)}${hex.slice(8, 12)}${hex.slice(13, 16)}`)
      ms = Number((ticks - GREGORIAN_OFFSET) / 10000n)
      break
    }
    case 7:
      ms = parseInt(hex.slice(0, 12), 16)
      break
    default:
      return Result.fail(new UuidError({ message: `Cannot extract a timestamp: not a v1, v6 or v7 UUID: ${uuid}` }))
  }
  return Result.succeed(DateTime.makeUnsafe(ms))
}
