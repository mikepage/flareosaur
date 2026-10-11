/**
 * @title Generate and validate UUIDs and ULIDs
 * @difficulty beginner
 * @tags workers, crypto
 * @group Cryptography
 * @resource {https://www.rfc-editor.org/rfc/rfc9562} RFC 9562: UUIDs
 * @resource {https://github.com/ulid/spec} ULID spec
 * @check GET / -> 200 "v4 version: 4" "v7 sorts by time: true" "v5 is stable: true" "valid: true" "invalid: false" "ulid decodes to 2026-"
 *
 * UUID v4 is random, v7 starts with a timestamp so new ids sort last, and
 * v5 is the same for the same name every time. ULIDs are sortable too, in a
 * shorter alphabet. Generation reads time and randomness from Effect
 * services (`Clock`, `Crypto`), so tests can pin both.
 */

import { Console, DateTime, Effect, Option, Schema } from "effect"
import { WebCrypto } from "@mikepage/flareosaur/crypto"
import * as Ulid from "@mikepage/flareosaur/ulid"
import * as Uuid from "@mikepage/flareosaur/uuid"
import { script } from "./_lib/script.ts"

const program = Effect.gen(function*() {
  const id = yield* Uuid.v4
  yield* Console.log(`v4 version: ${Option.getOrThrow(Uuid.version(id))}`)

  const first = yield* Uuid.v7()
  yield* Effect.sleep("2 millis")
  const second = yield* Uuid.v7()
  yield* Console.log(`v7 sorts by time: ${first < second}`)

  const a = yield* Uuid.v5(Uuid.NAMESPACE_URL, "https://example.com")
  const b = yield* Uuid.v5(Uuid.NAMESPACE_URL, "https://example.com")
  yield* Console.log(`v5 is stable: ${a === b}`)

  // Validate untrusted input with the branded Schema.
  const isValid = Schema.is(Uuid.Uuid)
  yield* Console.log(`valid: ${isValid(id)}, invalid: ${isValid("not-a-uuid")}`)

  const ulid = yield* Ulid.ulid()
  const time = Ulid.decodeTime(ulid)
  yield* Console.log(`ulid decodes to ${time._tag === "Success" ? DateTime.formatIso(time.success) : "?"}`)
}).pipe(Effect.provide(WebCrypto.layer))

export default script(program)
