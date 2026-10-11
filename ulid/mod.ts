// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2023 Yoshiya Hinosawa. All rights reserved. MIT license.
// Copyright 2017 Alizain Feerasta. All rights reserved. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * ULIDs (Universally Unique Lexicographically Sortable Identifiers), as
 * Effects.
 *
 * Effect's `Crypto` service has `randomULID` and Effect Schema has
 * `isULID`. This module adds what `@std/ulid` offers on top: ULIDs for an
 * explicit time, monotonic ULIDs (strictly increasing within a millisecond)
 * held in a {@linkcode MonotonicUlid} service, {@linkcode decodeTime}
 * returning a `DateTime`, and a branded {@linkcode Ulid} Schema.
 *
 * Time comes from Effect's `Clock` and randomness from Effect's `Crypto`
 * service; provide `WebCrypto.layer` from `@mikepage/flareosaur/crypto`.
 *
 * ```ts
 * import { Effect, Layer } from "effect"
 * import * as Ulid from "@mikepage/flareosaur/ulid"
 * import { WebCrypto } from "@mikepage/flareosaur/crypto"
 *
 * const program = Effect.gen(function*() {
 *   const a = yield* Ulid.monotonicUlid()
 *   const b = yield* Ulid.monotonicUlid()
 *   return a < b // true, even within the same millisecond
 * })
 *
 * Effect.runPromise(program.pipe(
 *   Effect.provide(Ulid.MonotonicUlid.layer.pipe(Layer.provide(WebCrypto.layer))),
 * ))
 * ```
 *
 * @module
 */

import { type Brand, type Cause, Context, Crypto, DateTime, Effect, Layer, Ref, Result, Schema } from "effect"
import { decodeTime as stdDecodeTime } from "./_std/decode_time.ts"
import { ENCODING, ENCODING_LEN, encodeTime, incrementBase32, RANDOM_LEN } from "./_std/_util.ts"

const UlidErrorBase: Schema.Class<
  UlidError,
  Schema.TaggedStruct<"UlidError", {
    readonly message: Schema.String
    readonly cause: Schema.optional<Schema.Defect>
  }>,
  Cause.YieldableError
> = Schema.TaggedError<UlidError>()("UlidError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
})

/** A ULID could not be generated or decoded. */
export class UlidError extends UlidErrorBase {}

const ulidError = (cause: unknown) =>
  new UlidError({ message: cause instanceof Error ? cause.message : String(cause), cause })

/** A string validated as a ULID. */
export type Ulid = string & Brand.Brand<"Ulid">

/** A ULID string: 26 Crockford base32 characters. Built on Effect's `Schema.isULID`. */
export const Ulid: Schema.brand<Schema.String, "Ulid"> =
  Schema.String.pipe(Schema.check(Schema.isULID()), Schema.brand("Ulid"))

const isUlidSchema = Schema.is(Ulid)

/** Whether `input` is a syntactically valid ULID. */
export const isUlid = (input: unknown): input is Ulid => isUlidSchema(input)

/** Options for the ULID generators. */
export interface UlidOptions {
  /** The time, as a `DateTime` or epoch milliseconds. The `Clock` by default. */
  readonly timestamp?: DateTime.DateTime | number | undefined
}

const currentMillis = (options: UlidOptions | undefined): Effect.Effect<number> => {
  const timestamp = options?.timestamp
  return timestamp === undefined
    ? Effect.clockWith((clock) => Effect.succeed(clock.currentTimeMillisUnsafe()))
    : Effect.succeed(typeof timestamp === "number" ? timestamp : DateTime.toEpochMillis(timestamp))
}

// 16 base32 characters from 16 random bytes, 5 bits each (std's encoding).
const randomPart: Effect.Effect<string, never, Crypto.Crypto> = Effect.gen(function*() {
  const crypto = yield* Crypto.Crypto
  const bytes = yield* Effect.orDie(crypto.randomBytes(RANDOM_LEN))
  let str = ""
  for (const byte of bytes) str += ENCODING[byte % ENCODING_LEN]
  return str
})

const time = (millis: number) => Effect.try({ try: () => encodeTime(millis), catch: ulidError })

/**
 * Generates a ULID: 10 characters of millisecond time followed by 16 random
 * characters. ULIDs of different milliseconds sort by time; use
 * {@linkcode monotonicUlid} for ordering within a millisecond.
 */
export const ulid = (options?: UlidOptions): Effect.Effect<Ulid, UlidError, Crypto.Crypto> =>
  Effect.gen(function*() {
    const encoded = yield* time(yield* currentMillis(options))
    return (encoded + (yield* randomPart)) as Ulid
  })

interface MonotonicState {
  readonly lastTime: number
  readonly lastRandom: string
}

/** A generator of monotonic ULIDs, as made by {@linkcode makeMonotonic}. */
export type MonotonicGenerator = (options?: UlidOptions) => Effect.Effect<Ulid, UlidError>

/**
 * Makes a monotonic ULID generator with its own state. When the time does
 * not advance past the previous ULID's (same millisecond, or a clock that
 * went backwards), the previous time is kept and its random part
 * incremented, so ULIDs stay strictly increasing.
 */
export const makeMonotonic: Effect.Effect<MonotonicGenerator, never, Crypto.Crypto> = Effect.gen(function*() {
  const crypto = yield* Crypto.Crypto
  const state = yield* Ref.make<MonotonicState>({ lastTime: 0, lastRandom: "" })
  return (options?: UlidOptions) =>
    Effect.gen(function*() {
      const millis = yield* currentMillis(options)
      const fresh = yield* Effect.provideService(randomPart, Crypto.Crypto, crypto)
      const result = yield* Ref.modify(state, (s): readonly [Result.Result<string, UlidError>, MonotonicState] => {
        if (s.lastRandom !== "" && millis <= s.lastTime) {
          const next = Result.try({ try: () => incrementBase32(s.lastRandom), catch: ulidError })
          return Result.isSuccess(next)
            ? [Result.succeed(encodeTime(s.lastTime) + next.success), { ...s, lastRandom: next.success }]
            : [next, s]
        }
        const encoded = Result.try({ try: () => encodeTime(millis), catch: ulidError })
        return Result.isSuccess(encoded)
          ? [Result.succeed(encoded.success + fresh), { lastTime: millis, lastRandom: fresh }]
          : [encoded, s]
      })
      return (yield* Effect.fromResult(result)) as Ulid
    })
})

const MonotonicUlidBase: Context.ServiceClass<
  MonotonicUlid,
  "flareosaur/ulid/MonotonicUlid",
  { readonly next: MonotonicGenerator }
> = Context.Service<MonotonicUlid, { readonly next: MonotonicGenerator }>()(
  "flareosaur/ulid/MonotonicUlid",
)

/** The service holding the state of {@linkcode monotonicUlid}. */
export class MonotonicUlid extends MonotonicUlidBase {
  /** A fresh monotonic generator, with randomness from Effect's `Crypto` service. */
  static readonly layer: Layer.Layer<MonotonicUlid, never, Crypto.Crypto> = Layer.effect(
    MonotonicUlid,
    Effect.map(makeMonotonic, (next) => MonotonicUlid.of({ next })),
  )
}

/** Generates a monotonic ULID with the {@linkcode MonotonicUlid} service. */
export const monotonicUlid = (options?: UlidOptions): Effect.Effect<Ulid, UlidError, MonotonicUlid> =>
  Effect.gen(function*() {
    const service = yield* MonotonicUlid
    return yield* service.next(options)
  })

/** The time encoded in a ULID (case-insensitive). */
export const decodeTime = (ulid: string): Result.Result<DateTime.Utc, UlidError> =>
  Result.map(
    Result.try({ try: () => stdDecodeTime(ulid.toUpperCase()), catch: ulidError }),
    (millis) => DateTime.makeUnsafe(millis),
  )
