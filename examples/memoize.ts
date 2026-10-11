/**
 * @title Memoize an expensive function
 * @difficulty intermediate
 * @tags workers, effect
 * @group Basics
 * @resource {https://effect.website/docs/caching/cache/} Effect: Cache
 * @check GET / -> 200 "computing 10" "computed 1 time(s) for 3 lookups" "lazy config loaded once"
 *
 * Memoization caches the result of a call so repeated calls are free. Effect's
 * `Cache` memoizes an effectful lookup with a capacity and a time to live, and
 * concurrent lookups of the same key share one computation.
 */

import { Cache, Console, Effect, Ref } from "effect"
import { script } from "./_lib/script.ts"

const program = Effect.gen(function*() {
  const computations = yield* Ref.make(0)

  // The lookup runs once per key; later calls read the cached value.
  const squares = yield* Cache.make({
    capacity: 100,
    timeToLive: "1 minute",
    lookup: (n: number) =>
      Ref.update(computations, (c) => c + 1).pipe(
        Effect.andThen(Console.log(`computing ${n}`)),
        Effect.as(n * n),
      ),
  })

  yield* Effect.all([Cache.get(squares, 10), Cache.get(squares, 10), Cache.get(squares, 10)], {
    concurrency: "unbounded",
  })
  yield* Console.log(`computed ${yield* Ref.get(computations)} time(s) for 3 lookups`)

  // Effect.cached memoizes a single effect, like a lazily loaded config.
  const loadConfig = yield* Effect.cached(Console.log("lazy config loaded once").pipe(Effect.as({ debug: true })))
  yield* loadConfig
  yield* loadConfig
})

export default script(program)
