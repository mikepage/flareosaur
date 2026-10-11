/**
 * @title Generate seeded random numbers
 * @difficulty beginner
 * @tags workers, effect
 * @group Basics
 * @resource {https://effect.website/docs/requirements-management/default-services/} Effect: default services
 * @check GET / -> 200 "same sequence: true" "dice:"
 *
 * `Math.random` cannot be seeded, so tests that depend on it are flaky.
 * Effect reads randomness from the `Random` service: run the same code with
 * `Random.withSeed` and it produces the same numbers every time.
 */

import { Console, Effect, Random } from "effect"
import { script } from "./_lib/script.ts"

// Three dice rolls, using whatever Random service is in scope.
const rolls = Effect.all([Random.nextIntBetween(1, 7), Random.nextIntBetween(1, 7), Random.nextIntBetween(1, 7)])

const program = Effect.gen(function*() {
  const first = yield* rolls.pipe(Random.withSeed("dice"))
  const second = yield* rolls.pipe(Random.withSeed("dice"))
  yield* Console.log(`same sequence: ${first.join() === second.join()}`)
  yield* Console.log(`dice: ${first.join(", ")}`)

  // Shuffle and pick, deterministically too.
  const deck = yield* Random.shuffle(["A", "K", "Q", "J"]).pipe(Random.withSeed(42))
  yield* Console.log(`shuffled: ${deck.join(" ")}`)
})

export default script(program)
