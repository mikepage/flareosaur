/**
 * @title Run tasks with a concurrency limit
 * @difficulty intermediate
 * @tags workers, effect
 * @group Basics
 * @resource {https://effect.website/docs/concurrency/basic-concurrency/} Effect: concurrency
 * @check GET / -> 200 "processed 10 items" "at most 3 at once" "semaphore: 2 at once"
 *
 * Firing hundreds of requests at once can overload a service or hit a rate
 * limit. `Effect.forEach` takes a `concurrency` option, and a `Semaphore`
 * limits concurrency across unrelated parts of a program.
 */

import { Console, Effect, Ref, Semaphore } from "effect"
import { script } from "./_lib/script.ts"

const program = Effect.gen(function*() {
  const running = yield* Ref.make(0)
  const peak = yield* Ref.make(0)

  // A task that records how many tasks run at the same time.
  const task = (n: number) =>
    Effect.gen(function*() {
      const now = yield* Ref.updateAndGet(running, (r) => r + 1)
      yield* Ref.update(peak, (p) => Math.max(p, now))
      yield* Effect.sleep("10 millis")
      yield* Ref.update(running, (r) => r - 1)
      return n * 2
    })

  // Ten tasks, three at a time. Results keep the input order.
  const results = yield* Effect.forEach(Array.from({ length: 10 }, (_, i) => i), task, { concurrency: 3 })
  yield* Console.log(`processed ${results.length} items, at most ${yield* Ref.get(peak)} at once`)

  // A semaphore with 2 permits, shared by every caller of `limited`.
  const semaphore = yield* Semaphore.make(2)
  yield* Ref.set(peak, 0)
  const limited = (n: number) => semaphore.withPermits(1)(task(n))
  yield* Effect.all([limited(1), limited(2), limited(3), limited(4)], { concurrency: "unbounded" })
  yield* Console.log(`semaphore: ${yield* Ref.get(peak)} at once`)
})

export default script(program)
