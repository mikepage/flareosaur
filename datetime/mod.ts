// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * Pattern-based formatting and parsing, and calendar helpers, for Effect's
 * `DateTime`.
 *
 * Effect's `DateTime` and `Duration` cover dates, time zones, arithmetic and
 * ISO/Intl formatting; use them directly. This module adds what `@std/datetime`
 * has on top:
 *
 * - {@linkcode format} and {@linkcode parse} with Unicode-style patterns
 *   (`"yyyy-MM-dd HH:mm:ss.SSS a"`), on the wall-clock time of a `DateTime`
 *   (UTC, or its zone when zoned), plus {@linkcode schema} as a Schema codec.
 * - {@linkcode dayOfYear}, {@linkcode weekOfYear} (ISO 8601),
 *   {@linkcode isLeap} and {@linkcode difference} in calendar units.
 * - Time constants as `Duration`, and month and weekday numbers matching
 *   `DateTime.toParts` (months 1 to 12, weekdays 0 = Sunday).
 *
 * ```ts
 * import { DateTime, Result } from "effect"
 * import * as Dt from "@mikepage/flareosaur/datetime"
 *
 * const at = DateTime.makeUnsafe("2019-01-20T16:30:00Z")
 * Dt.format(at, "yyyy-MM-dd HH:mm") // "2019-01-20 16:30"
 * Dt.weekOfYear(at) // 3
 *
 * const parsed = Dt.parse("20-01-2019 04:30 PM", "dd-MM-yyyy hh:mm a")
 * Result.map(parsed, DateTime.formatIso) // Result.succeed("2019-01-20T16:30:00.000Z")
 * ```
 *
 * @module
 */

import {
  type Cause,
  DateTime,
  Duration,
  Effect,
  Function,
  Result,
  Schema,
  SchemaGetter,
  SchemaIssue,
  SchemaTransformation,
} from "effect"
import { DateTimeFormatter } from "./_std/_date_time_formatter.ts"

const DateTimeParseErrorBase: Schema.Class<
  DateTimeParseError,
  Schema.TaggedStruct<"DateTimeParseError", {
    readonly message: Schema.String
    readonly input: Schema.String
    readonly pattern: Schema.String
    readonly cause: Schema.optional<Schema.Defect>
  }>,
  Cause.YieldableError
> = Schema.TaggedError<DateTimeParseError>()("DateTimeParseError", {
  message: Schema.String,
  input: Schema.String,
  pattern: Schema.String,
  cause: Schema.optional(Schema.Defect()),
})

/** A string did not match a date/time pattern, or named an impossible date. */
export class DateTimeParseError extends DateTimeParseErrorBase {}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** One second. */
export const SECOND: Duration.Duration = Duration.seconds(1)
/** One minute. */
export const MINUTE: Duration.Duration = Duration.minutes(1)
/** One hour. */
export const HOUR: Duration.Duration = Duration.hours(1)
/** One day (24 hours). */
export const DAY: Duration.Duration = Duration.days(1)
/** One week (7 days). */
export const WEEK: Duration.Duration = Duration.weeks(1)

/** January, as `DateTime.toParts(...).month` numbers it (1-based). */
export const JANUARY = 1
/** February. */
export const FEBRUARY = 2
/** March. */
export const MARCH = 3
/** April. */
export const APRIL = 4
/** May. */
export const MAY = 5
/** June. */
export const JUNE = 6
/** July. */
export const JULY = 7
/** August. */
export const AUGUST = 8
/** September. */
export const SEPTEMBER = 9
/** October. */
export const OCTOBER = 10
/** November. */
export const NOVEMBER = 11
/** December. */
export const DECEMBER = 12

/** Sunday, as `DateTime.toParts(...).weekDay` numbers it. */
export const SUNDAY = 0
/** Monday. */
export const MONDAY = 1
/** Tuesday. */
export const TUESDAY = 2
/** Wednesday. */
export const WEDNESDAY = 3
/** Thursday. */
export const THURSDAY = 4
/** Friday. */
export const FRIDAY = 5
/** Saturday. */
export const SATURDAY = 6

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000

// Epoch milliseconds of a UTC calendar date; years 0-99 are not shifted to 19xx.
const utcMillis = (year: number, month: number, day: number, hour = 0, minute = 0, second = 0, ms = 0): number => {
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  date.setUTCHours(hour, minute, second, ms)
  return date.getTime()
}

const isLeapYear = (year: number): boolean => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0

const daysInMonth = (year: number, month: number): number =>
  month === 2 ? (isLeapYear(year) ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31

// ---------------------------------------------------------------------------
// Format and parse
// ---------------------------------------------------------------------------

/**
 * Formats the wall-clock time of a `DateTime` (UTC, or its zone when zoned)
 * with a pattern:
 *
 * | Symbol | Meaning |
 * | --- | --- |
 * | `yyyy` / `yy` | year, 4 or 2 digits |
 * | `MM` / `M` | month, padded or not |
 * | `dd` / `d` | day of month |
 * | `HH` / `H` | hour 0-23 |
 * | `hh` / `h` | hour 1-12 |
 * | `mm` / `m` | minute |
 * | `ss` / `s` | second |
 * | `SSS` / `SS` / `S` | fractional seconds |
 * | `a` | `AM` / `PM` |
 * | `'text'` | literal text |
 */
export const format: {
  (pattern: string): (self: DateTime.DateTime) => string
  (self: DateTime.DateTime, pattern: string): string
} = Function.dual(2, (self: DateTime.DateTime, pattern: string): string => {
  const p = DateTime.toParts(self)
  const wallClock = new Date(utcMillis(p.year, p.month, p.day, p.hour, p.minute, p.second, p.millisecond))
  return new DateTimeFormatter(pattern).format(wallClock, { timeZone: "UTC" })
})

/** Options for {@linkcode parse} and {@linkcode parseZoned}. */
export interface ParseOptions {
  /**
   * Supplies the fields the pattern lacks (for example the year of
   * `"MM-dd"`), read as wall-clock parts. Defaults to 1970-01-01T00:00:00.000.
   */
  readonly base?: DateTime.DateTime | undefined
}

const parseParts = (
  text: string,
  pattern: string,
  base: DateTime.DateTime | undefined,
): Result.Result<DateTime.DateTime.Parts, DateTimeParseError> => {
  const fail = (message: string, cause?: unknown) =>
    Result.fail(
      new DateTimeParseError(cause === undefined ? { message, input: text, pattern } : { message, input: text, pattern, cause }),
    )
  let parts: ReadonlyArray<{ readonly type: string; readonly value: string }>
  try {
    parts = new DateTimeFormatter(pattern).formatToParts(text)
  } catch (cause) {
    return fail(cause instanceof Error ? cause.message : String(cause), cause)
  }
  const b = base === undefined ? undefined : DateTime.toParts(base)
  const fields = {
    year: b?.year ?? 1970,
    month: b?.month ?? 1,
    day: b?.day ?? 1,
    hour: 0,
    minute: 0,
    second: 0,
    millisecond: 0,
  }
  let dayPeriod: "AM" | "PM" | undefined
  for (const { type, value } of parts) {
    switch (type) {
      case "year":
        fields.year = Number(value.padStart(4, "20"))
        break
      case "month":
        fields.month = Number(value)
        break
      case "day":
        fields.day = Number(value)
        break
      case "hour":
        fields.hour = Number(value)
        break
      case "minute":
        fields.minute = Number(value)
        break
      case "second":
        fields.second = Number(value)
        break
      case "fractionalSecond":
        fields.millisecond = Number(value.padEnd(3, "0"))
        break
      case "dayPeriod":
        dayPeriod = value.toUpperCase() === "PM" ? "PM" : "AM"
        break
    }
  }
  if (dayPeriod !== undefined) {
    if (fields.hour < 1 || fields.hour > 12) return fail(`Hour ${fields.hour} is out of range for ${dayPeriod}`)
    if (dayPeriod === "PM" && fields.hour < 12) fields.hour += 12
    if (dayPeriod === "AM" && fields.hour === 12) fields.hour = 0
  }
  if (fields.month < 1 || fields.month > 12) return fail(`Month ${fields.month} is out of range`)
  if (fields.day < 1 || fields.day > daysInMonth(fields.year, fields.month)) {
    return fail(`Day ${fields.day} is out of range for ${fields.year}-${String(fields.month).padStart(2, "0")}`)
  }
  if (fields.hour > 23) return fail(`Hour ${fields.hour} is out of range`)
  if (fields.minute > 59) return fail(`Minute ${fields.minute} is out of range`)
  if (fields.second > 59) return fail(`Second ${fields.second} is out of range`)
  return Result.succeed(fields)
}

/**
 * Parses text with a pattern (see {@linkcode format}) as a UTC time. Fields
 * the pattern lacks come from `options.base`, else 1970-01-01T00:00:00.000.
 * Fails on text that does not match and on impossible dates
 * (`"31-02-2019"`).
 */
export const parse = (
  text: string,
  pattern: string,
  options?: ParseOptions,
): Result.Result<DateTime.Utc, DateTimeParseError> =>
  Result.map(
    parseParts(text, pattern, options?.base),
    (p) => DateTime.makeUnsafe(utcMillis(p.year, p.month, p.day, p.hour, p.minute, p.second, p.millisecond)),
  )

/**
 * Parses text with a pattern as a wall-clock time in `timeZone` (an IANA
 * name, an offset in milliseconds, or a `DateTime.TimeZone`).
 */
export const parseZoned = (
  text: string,
  pattern: string,
  timeZone: DateTime.TimeZone | string | number,
  options?: ParseOptions,
): Result.Result<DateTime.Zoned, DateTimeParseError> =>
  Result.flatMap(parseParts(text, pattern, options?.base), (parts) =>
    Result.fromOption(
      DateTime.makeZoned(parts, { timeZone, adjustForTimeZone: true }),
      () => new DateTimeParseError({ message: `Invalid time zone: ${String(timeZone)}`, input: text, pattern }),
    ))

/** A transformation between text in `pattern` and a UTC `DateTime`. */
export const transformation = (pattern: string): SchemaTransformation.Transformation<DateTime.Utc, string> =>
  new SchemaTransformation.Transformation(
    SchemaGetter.transformEffect((text: string) =>
      Effect.fromResult(parse(text, pattern)).pipe(
        Effect.mapError((error) => new SchemaIssue.InvalidValue({ message: error.message }, text)),
      )
    ),
    SchemaGetter.transform((dateTime: DateTime.Utc) => format(dateTime, pattern)),
  )

/**
 * A Schema that decodes text in `pattern` into a UTC `DateTime` and encodes
 * it back.
 *
 * ```ts
 * import { Schema } from "effect"
 * import * as Dt from "@mikepage/flareosaur/datetime"
 *
 * const decode = Schema.decodeUnknownSync(Dt.schema("yyyy-MM-dd"))
 * decode("2019-01-20") // DateTime.Utc 2019-01-20T00:00:00.000Z
 * ```
 */
export const schema = (pattern: string): Schema.decodeTo<Schema.DateTimeUtc, Schema.String> =>
  Schema.String.pipe(Schema.decodeTo(Schema.DateTimeUtc, transformation(pattern)))

// ---------------------------------------------------------------------------
// Calendar helpers
// ---------------------------------------------------------------------------

/** The day of the year (1 to 366) of the wall-clock date of a `DateTime`. */
export const dayOfYear = (self: DateTime.DateTime): number => {
  const p = DateTime.toParts(self)
  return Math.round((utcMillis(p.year, p.month, p.day) - utcMillis(p.year, 1, 1)) / DAY_MS) + 1
}

/** The ISO 8601 week number (1 to 53) of the wall-clock date of a `DateTime`. */
export const weekOfYear = (self: DateTime.DateTime): number => {
  const p = DateTime.toParts(self)
  const weekDay = p.weekDay === SUNDAY ? 7 : p.weekDay
  // The Thursday of the same ISO week decides the year the week belongs to.
  const thursday = new Date(utcMillis(p.year, p.month, p.day + THURSDAY - weekDay))
  const yearStart = utcMillis(thursday.getUTCFullYear(), 1, 1)
  return Math.ceil((thursday.getTime() - yearStart + DAY_MS) / (7 * DAY_MS))
}

/** Whether a year (or the wall-clock year of a `DateTime`) is a leap year. */
export const isLeap = (year: number | DateTime.DateTime): boolean =>
  isLeapYear(typeof year === "number" ? year : DateTime.toParts(year).year)

/** A calendar unit for {@linkcode difference}. */
export type Unit =
  | "milliseconds"
  | "seconds"
  | "minutes"
  | "hours"
  | "days"
  | "weeks"
  | "months"
  | "quarters"
  | "years"

/** The result of {@linkcode difference}: whole units, for the units asked for. */
export type Difference = { readonly [K in Unit]?: number }

/** Options for {@linkcode difference}. */
export interface DifferenceOptions {
  /** The units to compute. Defaults to all of them. */
  readonly units?: ReadonlyArray<Unit> | undefined
}

const ALL_UNITS: ReadonlyArray<Unit> = [
  "milliseconds",
  "seconds",
  "minutes",
  "hours",
  "days",
  "weeks",
  "months",
  "quarters",
  "years",
]

/**
 * The absolute difference between two `DateTime`s in whole calendar units,
 * each unit computed independently (`{ days: 366, years: 1, ... }`). Months,
 * quarters and years follow the wall-clock calendar. For an exact span use
 * `DateTime.distance`, which returns a `Duration`.
 */
export const difference: {
  (that: DateTime.DateTime, options?: DifferenceOptions): (self: DateTime.DateTime) => Difference
  (self: DateTime.DateTime, that: DateTime.DateTime, options?: DifferenceOptions): Difference
} = Function.dual(
  (args) => DateTime.isDateTime(args[1]),
  (self: DateTime.DateTime, that: DateTime.DateTime, options?: DifferenceOptions): Difference => {
    const [from, to] = DateTime.isLessThan(self, that) ? [self, that] : [that, self]
    const ms = DateTime.toEpochMillis(to) - DateTime.toEpochMillis(from)
    let months: number | undefined
    const calendarMonths = () => {
      if (months === undefined) {
        const f = DateTime.toParts(from)
        const t = DateTime.toParts(to)
        months = (t.year - f.year) * 12 + (t.month - f.month)
        if (t.day < f.day) months--
      }
      return months
    }
    const result: { [K in Unit]?: number } = {}
    for (const unit of new Set(options?.units ?? ALL_UNITS)) {
      switch (unit) {
        case "milliseconds":
          result.milliseconds = ms
          break
        case "seconds":
          result.seconds = Math.floor(ms / 1000)
          break
        case "minutes":
          result.minutes = Math.floor(ms / 60_000)
          break
        case "hours":
          result.hours = Math.floor(ms / 3_600_000)
          break
        case "days":
          result.days = Math.floor(ms / DAY_MS)
          break
        case "weeks":
          result.weeks = Math.floor(ms / (7 * DAY_MS))
          break
        case "months":
          result.months = calendarMonths()
          break
        case "quarters":
          result.quarters = Math.floor(calendarMonths() / 3)
          break
        case "years":
          result.years = Math.floor(calendarMonths() / 12)
          break
      }
    }
    return result
  },
)
