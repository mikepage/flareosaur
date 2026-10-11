/**
 * @title Sleep and delay execution
 * @difficulty beginner
 * @tags workers, effect
 * @group Basics
 * @resource {https://effect.website/docs/scheduling/introduction/} Effect: scheduling
 * @check GET / -> 200 "waiting..." "done" "slept and then said: woke up" "sleep canceled after 50ms"
 *
 * Programs often need to wait: between retries, while polling, or to pace
 * requests. In Effect a sleep is just another effect: it never blocks, it
 * reads time from the `Clock` (so tests can fast-forward it), and it can be
 * interrupted.
 */

import { Console, Effect, Fiber } from "effect"
import { script } from "./_lib/script.ts"

const program = Effect.gen(function*() {
  // Effect.sleep takes a duration: a number of milliseconds, or a string
  // like "100 millis" or "2 seconds".
  yield* Console.log("waiting...")
  yield* Effect.sleep("100 millis")
  yield* Console.log("done") // prints 100ms later

  // Effect.delay sleeps before running another effect.
  const said = yield* Effect.succeed("woke up").pipe(Effect.delay("50 millis"))
  yield* Console.log(`slept and then said: ${said}`)

  // A sleep can be canceled by interrupting the fiber it runs on. There is
  // no AbortController to thread through: interruption is built in.
  const sleeper = yield* Effect.forkChild(Effect.sleep("10 seconds"))
  yield* Effect.sleep("50 millis")
  yield* Fiber.interrupt(sleeper)
  yield* Console.log("sleep canceled after 50ms")
})

// script() turns the program into a Worker that responds with what it printed.
export default script(program)
