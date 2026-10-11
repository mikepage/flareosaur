// Copyright 2026 the flareosaur authors. MIT license.
import { ByteSize, ConfigProvider, Duration, Effect, Layer } from "effect"
import { describe, it } from "../testing/mod.ts"
import { assertEquals, assertStrictEquals } from "../assert/mod.ts"
import { Colors, formatBytes, formatDuration, sprintf } from "./mod.ts"

describe("formatBytes", () => {
  it("formats byte counts", () => {
    assertEquals(formatBytes(0), "0 B")
    assertEquals(formatBytes(0.4), "0.4 B")
    assertEquals(formatBytes(10.1), "10.1 B")
    assertEquals(formatBytes(999), "999 B")
    assertEquals(formatBytes(1001), "1 kB")
    assertEquals(formatBytes(1337), "1.34 kB")
    assertEquals(formatBytes(1e16), "10 PB")
    assertEquals(formatBytes(1e30), "1000000 YB")
  })

  it("formats negative and signed numbers", () => {
    assertEquals(formatBytes(-0.4), "-0.4 B")
    assertEquals(formatBytes(-1001), "-1 kB")
    assertEquals(formatBytes(42, { signed: true }), "+42 B")
    assertEquals(formatBytes(0, { signed: true }), " 0 B")
  })

  it("supports bits, binary prefixes, locales and fraction digits", () => {
    assertEquals(formatBytes(0, { bits: true }), "0 b")
    assertEquals(formatBytes(1001, { bits: true }), "1 kbit")
    assertEquals(formatBytes(1025, { binary: true }), "1 kiB")
    assertEquals(formatBytes(1e16, { binary: true }), "8.88 PiB")
    assertEquals(formatBytes(-0.4, { locale: "de" }), "-0,4 B")
    assertEquals(formatBytes(1900, { maximumFractionDigits: 1 }), "1.9 kB")
    assertEquals(formatBytes(1900, { minimumFractionDigits: 3 }), "1.900 kB")
  })

  it("accepts an Effect ByteSize", () => {
    assertEquals(formatBytes(ByteSize.kilobytes(2)), "2 kB")
    assertEquals(formatBytes(ByteSize.mebibytes(3), { binary: true }), "3 MiB")
  })

  it("returns non-finite numbers as text", () => {
    assertEquals(formatBytes(Number.NaN), "NaN")
    assertEquals(formatBytes(Number.POSITIVE_INFINITY), "Infinity")
  })
})

describe("formatDuration", () => {
  it("formats milliseconds in the narrow style by default", () => {
    assertEquals(formatDuration(99674), "0d 0h 1m 39s 674ms 0µs 0ns")
    assertEquals(formatDuration(99674, { ignoreZero: true }), "1m 39s 674ms")
  })

  it("formats the full and digital styles", () => {
    assertEquals(
      formatDuration(99674, { style: "full" }),
      "0 days, 0 hours, 1 minute, 39 seconds, 674 milliseconds, 0 microseconds, 0 nanoseconds",
    )
    assertEquals(formatDuration(99674, { style: "full", ignoreZero: true }), "1 minute, 39 seconds, 674 milliseconds")
    assertEquals(formatDuration(99674, { style: "digital" }), "00:00:01:39:674:000:000")
    assertEquals(formatDuration(99674, { style: "digital", ignoreZero: true }), "00:00:01:39:674")
  })

  it("accepts any Duration.Input", () => {
    assertEquals(formatDuration(Duration.minutes(90), { ignoreZero: true }), "1h 30m")
    assertEquals(formatDuration("2 days", { ignoreZero: true }), "2d")
    assertEquals(formatDuration(Duration.nanos(16_342_000n), { ignoreZero: true }), "16ms 342µs")
    assertEquals(formatDuration(Duration.nanos(1500n), { ignoreZero: true }), "1µs 500ns")
  })

  it("formats negative durations by magnitude and infinite ones as Infinity", () => {
    assertEquals(formatDuration(-99674, { style: "digital" }), "00:00:01:39:674:000:000")
    assertEquals(formatDuration(Duration.infinity), "Infinity")
  })
})

describe("sprintf", () => {
  it("formats verbs", () => {
    assertEquals(sprintf("bla"), "bla")
    assertEquals(sprintf("%%"), "%")
    assertEquals(sprintf("%t", true), "true")
    assertEquals(sprintf("%-10t", false), "false     ")
    assertEquals(sprintf("%b", 4), "100")
    assertEquals(sprintf("%c", 0x1f4a9), "💩")
    assertEquals(sprintf("%d", -4), "-4")
    assertEquals(sprintf("%05.2f", 3.14159), "03.14")
    assertEquals(sprintf("%x", 255), "ff")
    assertEquals(sprintf("%s is %d years old", "Deno", 7), "Deno is 7 years old")
    assertEquals(sprintf("%[2]s %[1]s", "world", "hello"), "hello world")
    assertEquals(sprintf("%j", { a: 1 }), '{"a":1}')
  })

  it("reports bad verbs and missing arguments inline", () => {
    assertEquals(sprintf("%d"), "%!(MISSING 'd')")
    assertEquals(sprintf("%d %f A", 1), "1 %!(MISSING 'f') A")
    assertEquals(sprintf("A %h", ""), "A %!(BAD VERB 'h')")
  })
})

describe("Colors", () => {
  it("styles text with ANSI codes", () => {
    assertEquals(Colors.red("foo bar"), "\x1b[31mfoo bar\x1b[39m")
    assertEquals(Colors.bold(Colors.green("ok")), "\x1b[1m\x1b[32mok\x1b[39m\x1b[22m")
    assertEquals(Colors.bgBrightWhite("x"), "\x1b[107mx\x1b[49m")
    assertEquals(Colors.rgb8("foo bar", 42), "\x1b[38;5;42mfoo bar\x1b[39m")
    assertEquals(Colors.bgRgb24("foo bar", { r: 41, g: 42, b: 43 }), "\x1b[48;2;41;42;43mfoo bar\x1b[49m")
    assertEquals(Colors.rgb24("foo bar", 0x070809), "\x1b[38;2;7;8;9mfoo bar\x1b[39m")
  })

  it("strips ANSI codes", () => {
    assertEquals(Colors.stripAnsiCode(Colors.red(Colors.bold("text"))), "text")
  })

  it("palettes cover every style", () => {
    for (const name of Object.keys(Colors.colored) as Array<keyof Colors.Palette>) {
      assertEquals(typeof Colors.plain[name], "function", name)
    }
    assertEquals(Colors.colored.underline("u"), Colors.underline("u"))
    assertEquals(Colors.plain.underline("u"), "u")
    assertEquals(Colors.plain.rgb24("u", 0xffffff), "u")
  })

  it.effect("palette follows NoColor", () =>
    Effect.gen(function*() {
      assertStrictEquals(yield* Colors.palette, Colors.colored)
      assertStrictEquals(yield* Colors.palette.pipe(Colors.withNoColor(true)), Colors.plain)
      assertStrictEquals(yield* Colors.palette.pipe(Colors.withNoColor(false)), Colors.colored)
      assertEquals(yield* Colors.NoColor, false)
    }))

  it.effect("layerNoColorFromEnv reads NO_COLOR", () =>
    Effect.gen(function*() {
      const env = (vars: Record<string, string>) =>
        Colors.layerNoColorFromEnv.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(vars))))
      assertStrictEquals(yield* Colors.palette.pipe(Effect.provide(env({ NO_COLOR: "1" }))), Colors.plain)
      assertStrictEquals(yield* Colors.palette.pipe(Effect.provide(env({ NO_COLOR: "" }))), Colors.colored)
      assertStrictEquals(yield* Colors.palette.pipe(Effect.provide(env({}))), Colors.colored)
    }))
})
