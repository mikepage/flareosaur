/**
 * @title Parse, format and compute with dates
 * @difficulty beginner
 * @tags workers, dates
 * @group Standard library
 * @resource {https://effect.website/docs/data-types/datetime/} Effect: DateTime
 * @check GET / -> 200 "formatted: 2026-10-11 14:30" "parsed: 2026-03-01T09:15:00.000Z" "invalid: DateTimeParseError" "in Amsterdam: 2026-10-11T16:30" "day 284, week 41" "until new year: 81 days"
 *
 * Effect's `DateTime` is an immutable instant (optionally with a time
 * zone) and reads "now" from the `Clock`, so code that uses the current
 * time stays testable. `@mikepage/flareosaur/datetime` adds std's
 * pattern-based `format` and `parse`, and calendar helpers.
 */

import { Console, DateTime, Duration, Effect } from "effect"
import * as Dates from "@mikepage/flareosaur/datetime"
import { script } from "./_lib/script.ts"

const program = Effect.gen(function*() {
  const meeting = DateTime.makeUnsafe("2026-10-11T14:30:00Z")
  yield* Console.log(`formatted: ${Dates.format(meeting, "yyyy-MM-dd HH:mm")}`)

  // Parsing returns a Result: a DateTime, or a typed error.
  const parsed = Dates.parse("01/03/2026 09:15", "dd/MM/yyyy HH:mm")
  if (parsed._tag === "Success") yield* Console.log(`parsed: ${DateTime.formatIso(parsed.success)}`)
  const invalid = Dates.parse("31/02/2026 09:15", "dd/MM/yyyy HH:mm")
  if (invalid._tag === "Failure") yield* Console.log(`invalid: ${invalid.failure._tag}`)

  // Time zones are part of the value.
  const amsterdam = DateTime.makeZonedUnsafe(meeting, { timeZone: "Europe/Amsterdam" })
  yield* Console.log(`in Amsterdam: ${DateTime.formatIsoZoned(amsterdam).slice(0, 16)}`)

  yield* Console.log(`day ${Dates.dayOfYear(meeting)}, week ${Dates.weekOfYear(meeting)}`)

  // Arithmetic and distances.
  const newYear = DateTime.makeUnsafe("2027-01-01T00:00:00Z")
  const until = DateTime.distance(meeting, newYear)
  yield* Console.log(`until new year: ${Math.floor(Duration.toDays(until))} days`)
})

export default script(program)
