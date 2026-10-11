/**
 * @title Set timeouts and intervals with schedules
 * @difficulty beginner
 * @tags workers, effect
 * @group Basics
 * @resource {https://effect.website/docs/scheduling/repetition/} Effect: repetition
 * @check GET / -> 200 "tick 1" "tick 3" "polled 3 times" "timeout fired"
 *
 * Where a Deno script reaches for `setTimeout` and `setInterval`, Effect
 * uses schedules: values that describe when to run something again. They
 * compose, they stop on their own, and they work with the test clock.
 */

import { Console, Effect, Ref, Schedule } from "effect"
import { script } from "./_lib/script.ts"

const program = Effect.gen(function*() {
  // setInterval: repeat an effect with a fixed spacing. Schedule.recurs
  // caps the number of repetitions (the first run is not a repetition).
  const ticks = yield* Ref.make(0)
  yield* Ref.updateAndGet(ticks, (n) => n + 1).pipe(
    Effect.flatMap((n) => Console.log(`tick ${n}`)),
    Effect.repeat(Schedule.max([Schedule.spaced("10 millis"), Schedule.recurs(2)])),
  )

  // Polling until a condition holds: repeat while the job is not done.
  const attempts = yield* Ref.make(0)
  const poll = Ref.updateAndGet(attempts, (n) => n + 1)
  yield* poll.pipe(Effect.repeat({ schedule: Schedule.spaced("5 millis"), until: (n) => n >= 3 }))
  yield* Console.log(`polled ${yield* Ref.get(attempts)} times`)

  // setTimeout: run something once after a delay.
  yield* Console.log("timeout fired").pipe(Effect.delay("20 millis"))
})

export default script(program)
