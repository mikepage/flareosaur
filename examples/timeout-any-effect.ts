/**
 * @title Add a timeout to any effect
 * @difficulty beginner
 * @tags workers, effect
 * @group Basics
 * @resource {https://effect.website/docs/getting-started/control-flow/} Effect: control flow
 * @check GET / -> 200 "fast: 42" "slow: TimeoutError" "fallback: cached value" "option: none"
 *
 * A promise has no built-in time limit. Every effect does: `Effect.timeout`
 * fails with a `TimeoutError` when the time runs out, and interrupts the
 * work that was too slow, so nothing keeps running in the background.
 */

import { Cause, Console, Effect, Option } from "effect"
import { script } from "./_lib/script.ts"

const fast = Effect.succeed(42).pipe(Effect.delay("10 millis"))
const slow = Effect.succeed(0).pipe(Effect.delay("1 second"))

const program = Effect.gen(function*() {
  // Within the limit: the value comes through.
  yield* Console.log(`fast: ${yield* fast.pipe(Effect.timeout("100 millis"))}`)

  // Over the limit: a typed TimeoutError in the error channel.
  const result = yield* slow.pipe(Effect.timeout("50 millis"), Effect.flip)
  yield* Console.log(`slow: ${Cause.isTimeoutError(result) ? "TimeoutError" : "?"}`)

  // Fall back to another effect instead of failing.
  const fallback = yield* slow.pipe(
    Effect.timeoutOrElse({ duration: "50 millis", orElse: () => Effect.succeed("cached value") }),
  )
  yield* Console.log(`fallback: ${fallback}`)

  // Or get an Option: None when the time ran out.
  const option = yield* slow.pipe(Effect.timeoutOption("50 millis"))
  yield* Console.log(`option: ${Option.isNone(option) ? "none" : option.value}`)
})

export default script(program)
