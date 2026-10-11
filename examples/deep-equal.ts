/**
 * @title Check if two values are deeply equal
 * @difficulty beginner
 * @tags workers, effect
 * @group Basics
 * @resource {https://effect.website/docs/trait/equal/} Effect: Equal
 * @check GET / -> 200 "=== false" "Equal.equals: true" "Data classes: true" "HashSet: true"
 *
 * Two objects with the same contents are not equal with `===`. Effect's
 * `Equal.equals` compares structurally: plain objects, arrays, Maps, Sets
 * and Dates by value, and Effect data types (Data classes, Option, HashMap,
 * ...) by their own equality.
 */

import { Console, Data, Effect, Equal, HashSet, Option } from "effect"
import { script } from "./_lib/script.ts"

const a = { name: "Ada", languages: ["en", "fr"] }
const b = { name: "Ada", languages: ["en", "fr"] }

// Data.Class gives a class value equality and a hash.
class Point extends Data.Class<{ readonly x: number; readonly y: number }> {}

const program = Effect.gen(function*() {
  yield* Console.log(`=== ${a === b}`) // === false
  yield* Console.log(`Equal.equals: ${Equal.equals(a, b)}`) // Equal.equals: true

  // Data classes and Option compare by value, so they can be used as keys.
  yield* Console.log(`Data classes: ${Equal.equals(new Point({ x: 1, y: 2 }), new Point({ x: 1, y: 2 }))}`)
  yield* Console.log(`Option: ${Equal.equals(Option.some([1, 2]), Option.some([1, 2]))}`)

  // A HashSet uses that equality, so the second point is a duplicate.
  const set = HashSet.make(new Point({ x: 1, y: 2 }), new Point({ x: 1, y: 2 }))
  yield* Console.log(`HashSet: ${HashSet.size(set) === 1}`)
})

export default script(program)
