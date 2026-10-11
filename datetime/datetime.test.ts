// Copyright 2026 the flareosaur authors. MIT license.
import { DateTime, Duration, Effect, Schema } from "effect"
import { describe, it } from "../testing/mod.ts"
import { assert, assertEquals, assertFailsWithTag, assertFailure, assertFalse, assertSuccess } from "../assert/mod.ts"
import * as Dt from "./mod.ts"

const utc = (iso: string) => DateTime.makeUnsafe(iso)
const iso = (self: DateTime.DateTime) => DateTime.formatIso(self)
const date = (y: number, m: number, d: number) => DateTime.makeUnsafe({ year: y, month: m, day: d })

describe("format", () => {
  it("formats hours, minutes and seconds", () => {
    assertEquals(Dt.format(utc("2019-01-01T00:00:00Z"), "HH:mm:ss"), "00:00:00")
    assertEquals(Dt.format(utc("2019-01-01T01:00:00Z"), "HH:mm:ss"), "01:00:00")
    assertEquals(Dt.format(utc("2019-01-01T13:00:00Z"), "HH:mm:ss"), "13:00:00")
  })

  it("formats 12-hour clocks and day periods", () => {
    assertEquals(Dt.format(utc("2019-01-01T00:00:00Z"), "hh:mm:ss"), "12:00:00")
    assertEquals(Dt.format(utc("2019-01-01T13:00:00Z"), "hh:mm:ss"), "01:00:00")
    assertEquals(Dt.format(utc("2019-01-01T00:00:00Z"), "HH:mm:ss a"), "00:00:00 AM")
    assertEquals(Dt.format(utc("2019-01-01T01:00:00Z"), "hh:mm:ss a"), "01:00:00 AM")
    assertEquals(Dt.format(utc("2019-01-01T21:00:00Z"), "hh:mm:ss a"), "09:00:00 PM")
    assertEquals(Dt.format(utc("2019-01-01T13:00:00Z"), "h"), "1")
  })

  it("formats fractional seconds", () => {
    assertEquals(Dt.format(utc("2019-01-01T13:00:00.123Z"), "HH:mm:ss.SSS"), "13:00:00.123")
    assertEquals(Dt.format(utc("2019-01-01T13:00:00.000Z"), "HH:mm:ss.SS"), "13:00:00.00")
    assertEquals(Dt.format(utc("2019-01-01T13:00:00.000Z"), "HH:mm:ss.S"), "13:00:00.0")
  })

  it("formats literals and short fields", () => {
    assertEquals(Dt.format(utc("2019-01-20T00:00:00Z"), "'today:' yyyy-MM-dd"), "today: 2019-01-20")
    assertEquals(Dt.format(utc("2019-01-09T21:09:09Z"), "H:m:s yy-M-d"), "21:9:9 19-1-9")
  })

  it("formats the wall-clock time of a zoned DateTime", () => {
    const zoned = DateTime.makeZonedUnsafe("2019-01-01T04:00:00Z", { timeZone: "Asia/Tokyo" })
    assertEquals(Dt.format(zoned, "yyyy-MM-dd HH:mm:ss.SSS"), "2019-01-01 13:00:00.000")
    assertEquals(Dt.format(DateTime.toUtc(zoned), "yyyy-MM-dd HH:mm:ss.SSS"), "2019-01-01 04:00:00.000")
  })

  it("is pipeable", () => {
    assertEquals(utc("2019-01-20T16:30:00Z").pipe(Dt.format("yyyy-MM-dd HH:mm")), "2019-01-20 16:30")
  })
})

describe("parse", () => {
  it("parses std's patterns", () => {
    const cases: ReadonlyArray<[string, string, string]> = [
      ["01-03-2019 16:30", "MM-dd-yyyy HH:mm", "2019-01-03T16:30:00.000Z"],
      ["01.03.2019 16:30", "MM.dd.yyyy HH:mm", "2019-01-03T16:30:00.000Z"],
      ["03-01-2019 16:31", "dd-MM-yyyy HH:mm", "2019-01-03T16:31:00.000Z"],
      ["2019-01-03 16:32", "yyyy-MM-dd HH:mm", "2019-01-03T16:32:00.000Z"],
      ["16:33 01-03-2019", "HH:mm MM-dd-yyyy", "2019-01-03T16:33:00.000Z"],
      ["01-03-2019 16:33:23.123", "MM-dd-yyyy HH:mm:ss.SSS", "2019-01-03T16:33:23.123Z"],
      ["01-03-2019 09:33 PM", "MM-dd-yyyy hh:mm a", "2019-01-03T21:33:00.000Z"],
      ["01-03-2019 09:33 PM.", "MM-dd-yyyy hh:mm a", "2019-01-03T21:33:00.000Z"],
      ["01-03-2019 09:33 P.M.", "MM-dd-yyyy hh:mm a", "2019-01-03T21:33:00.000Z"],
      ["16:35 2019-01-03", "HH:mm yyyy-MM-dd", "2019-01-03T16:35:00.000Z"],
      ["01-03-2019", "MM-dd-yyyy", "2019-01-03T00:00:00.000Z"],
      ["31-10-2019", "dd-MM-yyyy", "2019-10-31T00:00:00.000Z"],
      ["19-01-03", "yy-MM-dd", "2019-01-03T00:00:00.000Z"],
      ["3-1-19", "d-M-yy", "2019-01-03T00:00:00.000Z"],
    ]
    for (const [text, pattern, expected] of cases) {
      assertEquals(iso(assertSuccess(Dt.parse(text, pattern), text)), expected, text)
    }
  })

  it("handles 12 AM and 12 PM", () => {
    assertEquals(iso(assertSuccess(Dt.parse("2019-01-03 12:05 AM", "yyyy-MM-dd hh:mm a"))), "2019-01-03T00:05:00.000Z")
    assertEquals(iso(assertSuccess(Dt.parse("2019-01-03 12:05 PM", "yyyy-MM-dd hh:mm a"))), "2019-01-03T12:05:00.000Z")
  })

  it("scales short fractional seconds", () => {
    assertEquals(iso(assertSuccess(Dt.parse("00:00:00.5", "HH:mm:ss.S"))), "1970-01-01T00:00:00.500Z")
  })

  it("takes missing fields from base", () => {
    const base = utc("2021-12-31T00:00:00Z")
    assertEquals(iso(assertSuccess(Dt.parse("01-01", "MM-dd", { base }))), "2021-01-01T00:00:00.000Z")
    assertEquals(iso(assertSuccess(Dt.parse("02-01", "MM-dd", { base }))), "2021-02-01T00:00:00.000Z")
    assertEquals(iso(assertSuccess(Dt.parse("12:00", "HH:mm"))), "1970-01-01T12:00:00.000Z")
  })

  it("fails on text that does not match the pattern", () => {
    const error = assertFailure(Dt.parse("2019-01-03", "MM-dd-yyyy HH:mm"))
    assertEquals(error._tag, "DateTimeParseError")
    assertEquals(error.pattern, "MM-dd-yyyy HH:mm")
    assertEquals(error.input, "2019-01-03")
    assertFailure(Dt.parse("01-03-2019 16:30 extra", "MM-dd-yyyy HH:mm"))
  })

  it("fails on impossible dates", () => {
    assertFailure(Dt.parse("31-02-2019", "dd-MM-yyyy"))
    assertFailure(Dt.parse("29-02-2019", "dd-MM-yyyy"))
    assertSuccess(Dt.parse("29-02-2020", "dd-MM-yyyy"))
    assertFailure(Dt.parse("13-13-2019", "dd-MM-yyyy"))
    assertFailure(Dt.parse("25:00", "HH:mm"))
    assertFailure(Dt.parse("13:00 PM", "hh:mm a"))
  })
})

describe("parseZoned", () => {
  it("parses wall-clock time in a time zone", () => {
    const zoned = assertSuccess(Dt.parseZoned("2019-01-01 13:00", "yyyy-MM-dd HH:mm", "Asia/Tokyo"))
    assertEquals(iso(zoned), "2019-01-01T04:00:00.000Z")
    assertEquals(Dt.format(zoned, "HH:mm"), "13:00")
  })

  it("accepts an offset and fails on an unknown zone", () => {
    const zoned = assertSuccess(Dt.parseZoned("2019-01-01 13:00", "yyyy-MM-dd HH:mm", -5 * 60 * 60 * 1000))
    assertEquals(iso(zoned), "2019-01-01T18:00:00.000Z")
    assertFailure(Dt.parseZoned("2019-01-01 13:00", "yyyy-MM-dd HH:mm", "Nowhere/Nothing"))
  })
})

describe("schema", () => {
  it.effect("decodes and encodes with a pattern", () =>
    Effect.gen(function*() {
      const S = Dt.schema("yyyy-MM-dd HH:mm")
      const value = yield* Schema.decodeUnknownEffect(S)("2019-01-20 16:30")
      assertEquals(iso(value), "2019-01-20T16:30:00.000Z")
      assertEquals(yield* Schema.encodeEffect(S)(value), "2019-01-20 16:30")
      yield* assertFailsWithTag(Schema.decodeUnknownEffect(S)("20-01-2019"), "SchemaError")
    }))
})

describe("dayOfYear", () => {
  it("counts from 1", () => {
    assertEquals(Dt.dayOfYear(utc("2019-03-11T03:24:00Z")), 70)
    assertEquals(Dt.dayOfYear(utc("2019-01-01T00:00:00Z")), 1)
    assertEquals(Dt.dayOfYear(utc("2019-12-31T23:59:59Z")), 365)
    assertEquals(Dt.dayOfYear(utc("2020-12-31T00:00:00Z")), 366)
  })

  it("handles years 0-99 and zoned values", () => {
    assertEquals(Dt.dayOfYear(DateTime.makeUnsafe(new Date("0024-03-01T00:00:00Z"))), 61)
    const zoned = DateTime.makeZonedUnsafe("2019-12-31T20:00:00Z", { timeZone: "Asia/Tokyo" })
    assertEquals(Dt.dayOfYear(zoned), 1)
  })
})

describe("weekOfYear", () => {
  it("computes ISO weeks", () => {
    const cases: ReadonlyArray<[number, number, number, number]> = [
      [2020, 1, 5, 1],
      [2020, 6, 28, 26],
      [2012, 1, 1, 52],
      [2012, 1, 2, 1],
      [2012, 1, 9, 2],
      [2007, 1, 1, 1],
      [2007, 1, 15, 3],
      [2007, 12, 31, 1],
      [2008, 1, 7, 2],
      [2002, 12, 30, 1],
      [2003, 1, 6, 2],
      [2008, 12, 29, 1],
      [2009, 1, 4, 1],
      [2009, 1, 5, 2],
      [2009, 12, 31, 53],
      [2010, 1, 3, 53],
    ]
    for (const [y, m, d, week] of cases) assertEquals(Dt.weekOfYear(date(y, m, d)), week, `${y}-${m}-${d}`)
  })
})

describe("isLeap", () => {
  it("checks years and DateTimes", () => {
    assert(Dt.isLeap(1992))
    assert(Dt.isLeap(2000))
    assertFalse(Dt.isLeap(1900))
    assertFalse(Dt.isLeap(2003))
    assert(Dt.isLeap(utc("2024-06-01T00:00:00Z")))
    assertFalse(Dt.isLeap(utc("2023-06-01T00:00:00Z")))
  })
})

describe("difference", () => {
  const denoInit = utc("2018-05-14T00:00:00Z")
  const denoReleaseV1 = utc("2020-05-13T00:00:00Z")

  it("is symmetric and computes calendar units", () => {
    assertEquals(Dt.difference(denoInit, denoReleaseV1), Dt.difference(denoReleaseV1, denoInit))
    const diff = Dt.difference(denoReleaseV1, denoInit, { units: ["days", "weeks", "months", "years", "quarters"] })
    assertEquals(diff, { days: 730, weeks: 104, months: 23, years: 1, quarters: 7 })
  })

  it("computes only the requested units", () => {
    assertEquals(Dt.difference(denoInit, denoReleaseV1, { units: ["quarters"] }), { quarters: 7 })
    assertEquals(Dt.difference(denoInit, denoReleaseV1, { units: ["years", "quarters"] }), { years: 1, quarters: 7 })
  })

  it("computes time units", () => {
    const diff = Dt.difference(utc("1998-02-23T10:10:10Z"), utc("1998-02-23T11:11:11Z"), {
      units: ["milliseconds", "minutes", "seconds", "hours"],
    })
    assertEquals(diff, { milliseconds: 3661000, minutes: 61, seconds: 3661, hours: 1 })
  })

  it("is pipeable", () => {
    assertEquals(denoInit.pipe(Dt.difference(denoReleaseV1, { units: ["years"] })), { years: 1 })
    assertEquals(denoInit.pipe(Dt.difference(denoReleaseV1)).days, 730)
  })
})

describe("constants", () => {
  it("are Durations and DateTime part numbers", () => {
    assertEquals(Duration.toMillis(Dt.SECOND), 1000)
    assertEquals(Duration.toMillis(Dt.MINUTE), 60_000)
    assertEquals(Duration.toMillis(Dt.HOUR), 3_600_000)
    assertEquals(Duration.toMillis(Dt.DAY), 86_400_000)
    assertEquals(Duration.toMillis(Dt.WEEK), 604_800_000)
    assertEquals(DateTime.toParts(utc("2019-01-06T00:00:00Z")).month, Dt.JANUARY)
    assertEquals(DateTime.toParts(utc("2019-12-06T00:00:00Z")).month, Dt.DECEMBER)
    assertEquals(DateTime.toParts(utc("2019-01-06T00:00:00Z")).weekDay, Dt.SUNDAY)
    assertEquals(DateTime.toParts(utc("2019-01-12T00:00:00Z")).weekDay, Dt.SATURDAY)
    assertEquals(
      [Dt.FEBRUARY, Dt.MARCH, Dt.APRIL, Dt.MAY, Dt.JUNE, Dt.JULY, Dt.AUGUST, Dt.SEPTEMBER, Dt.OCTOBER, Dt.NOVEMBER],
      [2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    )
    assertEquals([Dt.MONDAY, Dt.TUESDAY, Dt.WEDNESDAY, Dt.THURSDAY, Dt.FRIDAY], [1, 2, 3, 4, 5])
  })
})
