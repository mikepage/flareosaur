/**
 * @title Parse and serialize CSV, also as streams
 * @difficulty intermediate
 * @tags workers, encoding, streams
 * @group Data formats
 * @resource {https://www.rfc-editor.org/rfc/rfc4180} RFC 4180: CSV
 * @check GET / -> 200 "Ada (36) and Grace (85)" "total age: 121" "streamed 3 rows" "name,age"
 *
 * CSV is still how data moves between spreadsheets and systems. A Schema
 * codec decodes CSV with a header row into typed records, numbers included,
 * and `parseStream` handles files too big for memory one row at a time,
 * whatever the chunk boundaries are.
 */

import { Console, Effect, Schema, Stream } from "effect"
import * as Csv from "@mikepage/flareosaur/csv"
import { script } from "./_lib/script.ts"

const Person = Schema.Struct({ name: Schema.String, age: Schema.FiniteFromString })

const text = `name,age
Ada,36
Grace,85
`

const program = Effect.gen(function*() {
  // Header row + Schema = typed records.
  const people = yield* Schema.decodeEffect(Csv.schema(Person))(text)
  yield* Console.log(people.map((p) => `${p.name} (${p.age})`).join(" and "))
  yield* Console.log(`total age: ${people.reduce((sum, p) => sum + p.age, 0)}`)

  // Streaming: chunks can split rows anywhere.
  const chunks = Stream.make("name,age\nAd", "a,36\nGrace,8", "5\nLinus,54\n")
  const rows = yield* chunks.pipe(Csv.parseStream({ skipFirstRow: true }), Stream.runCollect)
  yield* Console.log(`streamed ${Array.from(rows).length} rows`)

  // Back to CSV text.
  yield* Console.log(yield* Csv.stringify(people.map((p) => ({ ...p, age: String(p.age) }))))
})

export default script(program)
