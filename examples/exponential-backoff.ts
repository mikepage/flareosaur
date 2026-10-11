/**
 * @title Retry with exponential backoff
 * @difficulty intermediate
 * @tags workers, effect
 * @group Basics
 * @resource {https://effect.website/docs/error-management/retrying/} Effect: retrying
 * @check GET / -> 200 "attempt 1 failed" "attempt 3 succeeded" "gave up after 4 attempts"
 *
 * Exponential backoff retries a failing operation with growing delays, so a
 * struggling service gets room to recover. In Effect the policy is a
 * `Schedule`, and `Effect.retry` applies it. Errors are typed, so the policy
 * can decide which ones are worth retrying.
 */

import { Console, Effect, Ref, Schedule, Schema } from "effect"
import { script } from "./_lib/script.ts"

class Unavailable extends Schema.TaggedError<Unavailable>()("Unavailable", {
  attempt: Schema.Int,
  retryable: Schema.Boolean,
}) {}

// Delays of 10ms, 20ms, 40ms, ... with jitter, at most 3 retries.
const backoff = Schedule.max([Schedule.exponential("10 millis"), Schedule.recurs(3)]).pipe(Schedule.jittered)

// A flaky call that succeeds on its third attempt.
const flaky = (attempts: Ref.Ref<number>, succeedOn: number) =>
  Effect.gen(function*() {
    const attempt = yield* Ref.updateAndGet(attempts, (n) => n + 1)
    if (attempt < succeedOn) {
      yield* Console.log(`attempt ${attempt} failed`)
      return yield* new Unavailable({ attempt, retryable: true })
    }
    yield* Console.log(`attempt ${attempt} succeeded`)
    return attempt
  })

const program = Effect.gen(function*() {
  yield* flaky(yield* Ref.make(0), 3).pipe(Effect.retry(backoff))

  // When every retry fails, the last error comes through, typed.
  const attempts = yield* Ref.make(0)
  const error = yield* flaky(attempts, 10).pipe(
    Effect.retry({ schedule: backoff, while: (e) => e.retryable }),
    Effect.flip,
  )
  yield* Console.log(`gave up after ${error.attempt} attempts`)
})

export default script(program)
