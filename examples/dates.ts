/**
 * @title Parse, format and compute with dates
 * @difficulty beginner
 * @tags workers, dates
 * @group Standard library
 * @resource {https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat} MDN: Intl.DateTimeFormat
 * @resource {https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/RelativeTimeFormat} MDN: Intl.RelativeTimeFormat
 * @resource {https://jsr.io/@std/datetime} @std/datetime
 * @check GET / -> 200 "formatted: 2026-10-11 14:30" "parsed: 2026-03-01T09:15:00.000Z" "invalid: Error" "in Amsterdam: 11-10-2026, 16:30" "in New York: Sunday, October 11, 2026 at 10:30" "day 284, week 41" "until new year: 81 days" "relative: in 81 days" "dutch: over 2 maanden"
 *
 * Workers have `Date` and the full `Intl` API with time zone data:
 * `Intl.DateTimeFormat` shows a moment in any zone and language, and
 * `Intl.RelativeTimeFormat` writes "in 3 days". std's datetime adds
 * pattern-based `format` and `parse`, calendar helpers and `difference`.
 * Workers run in UTC, so a `Date` without a zone is UTC.
 */

import {
  dayOfYear,
  difference,
  format,
  parse,
  weekOfYear,
} from "@mikepage/flareosaur/datetime";
import { script } from "./_lib/script.ts";

export default script((print) => {
  const meeting = new Date("2026-10-11T14:30:00Z");

  // A fixed pattern, for logs and file names.
  print(
    `formatted: ${format(meeting, "yyyy-MM-dd HH:mm", { timeZone: "UTC" })}`,
  );

  // Parse a date in a known pattern. Text that does not fit the pattern
  // throws.
  const parsed = parse("01/03/2026 09:15", "dd/MM/yyyy HH:mm");
  print(`parsed: ${parsed.toISOString()}`);
  try {
    parse("next tuesday", "dd/MM/yyyy HH:mm");
  } catch (error) {
    print(`invalid: ${error instanceof Error ? error.name : error}`);
  }

  // Intl formats for people: any time zone, any language.
  const amsterdam = new Intl.DateTimeFormat("nl-NL", {
    timeZone: "Europe/Amsterdam",
    dateStyle: "short",
    timeStyle: "short",
  });
  print(`in Amsterdam: ${amsterdam.format(meeting)}`);
  const newYork = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    dateStyle: "full",
    timeStyle: "short",
  });
  print(`in New York: ${newYork.format(meeting)}`);

  // Calendar helpers.
  print(`day ${dayOfYear(meeting)}, week ${weekOfYear(meeting)}`);

  // difference counts whole units between two dates.
  const newYear = new Date("2027-01-01T00:00:00Z");
  const until = difference(meeting, newYear, { units: ["days", "months"] });
  print(`until new year: ${until.days} days`);

  // RelativeTimeFormat words it.
  const en = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  print(`relative: ${en.format(until.days ?? 0, "day")}`);
  const nl = new Intl.RelativeTimeFormat("nl");
  print(`dutch: ${nl.format(until.months ?? 0, "month")}`);
});
