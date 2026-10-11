/**
 * @title Parse and compare semver versions
 * @difficulty beginner
 * @tags workers, semver
 * @group Standard library
 * @resource {https://semver.org} Semantic Versioning
 * @check GET / -> 200 "sorted: 1.2.0, 1.10.0, 2.0.0-beta.1, 2.0.0" "1.10.0 satisfies ^1.2.0: true" "best match for ~1.2: 1.2.0" "next minor: 1.11.0" "invalid: SemVerError"
 *
 * Version strings cannot be compared as text: "1.10.0" sorts before
 * "1.2.0". A parsed `SemVer` comes with an Effect `Order`, so arrays sort
 * correctly with `Array.sort`, and ranges, increments and comparisons follow
 * the semver spec. Parsing returns a `Result` instead of throwing.
 */

import { Array, Console, Effect, Option, Result } from "effect"
import * as SemVer from "@mikepage/flareosaur/semver"
import { script } from "./_lib/script.ts"

const program = Effect.gen(function*() {
  const versions = ["2.0.0", "1.10.0", "2.0.0-beta.1", "1.2.0"].map((v) => Result.getOrThrow(SemVer.parse(v)))

  // SemVer.Order knows that prereleases sort before the release.
  const sorted = Array.sort(versions, SemVer.Order)
  yield* Console.log(`sorted: ${sorted.map(SemVer.format).join(", ")}`)

  const caret = Result.getOrThrow(SemVer.parseRange("^1.2.0"))
  yield* Console.log(`1.10.0 satisfies ^1.2.0: ${SemVer.satisfies(versions[1]!, caret)}`)

  const tilde = Result.getOrThrow(SemVer.parseRange("~1.2"))
  const best = SemVer.maxSatisfying(versions, tilde)
  yield* Console.log(`best match for ~1.2: ${Option.match(best, { onNone: () => "none", onSome: SemVer.format })}`)

  const next = SemVer.increment(versions[1]!, "minor")
  yield* Console.log(`next minor: ${Result.match(next, { onFailure: () => "?", onSuccess: SemVer.format })}`)

  const invalid = SemVer.parse("one.two")
  yield* Console.log(`invalid: ${Result.isFailure(invalid) ? invalid.failure._tag : "?"}`)
})

export default script(program)
