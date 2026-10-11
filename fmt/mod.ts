// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * Human-readable formatting of byte sizes and durations, `sprintf`, and
 * terminal colors.
 *
 * `effect` formats `Duration` and `ByteSize` in one fixed style. This module
 * adds `@std/fmt`'s options on top: {@linkcode formatBytes} (bits, binary
 * prefixes, signs, locales, fraction digits) over a number or an Effect
 * `ByteSize`, {@linkcode formatDuration} (narrow, full and digital styles)
 * over any `Duration.Input`, and {@linkcode sprintf} with Go-style verbs.
 * Colors live in {@linkcode Colors}.
 *
 * ```ts
 * import { ByteSize } from "effect"
 * import { formatBytes, formatDuration, sprintf } from "@mikepage/flareosaur/fmt"
 *
 * formatBytes(1337) // "1.34 kB"
 * formatBytes(ByteSize.mebibytes(1), { binary: true }) // "1 MiB"
 * formatDuration("90 minutes", { ignoreZero: true }) // "1h 30m"
 * sprintf("%s is %d years old", "Deno", 7) // "Deno is 7 years old"
 * ```
 *
 * @module
 */

import { ByteSize, Duration, Option } from "effect"
import { format as stdBytes, type FormatOptions as BytesOptions } from "./_std/bytes.ts"
import { format as stdDuration, type FormatOptions as DurationOptions } from "./_std/duration.ts"
import { sprintf as stdSprintf } from "./_std/printf.ts"
import * as Colors from "./Colors.ts"

export { Colors }
export type { BytesOptions, DurationOptions }

/**
 * Formats a byte count for humans, e.g. `1337` as `"1.34 kB"`. Takes a
 * number or an Effect `ByteSize`. Options: `bits`, `binary` (KiB, MiB),
 * `signed`, `locale`, `minimumFractionDigits`, `maximumFractionDigits`.
 * Non-finite numbers are returned as `String(n)`.
 */
export const formatBytes = (bytes: number | ByteSize.ByteSize, options?: BytesOptions): string => {
  const n = typeof bytes === "number" ? bytes : ByteSize.toNumberUnsafe(bytes)
  return Number.isFinite(n) ? stdBytes(n, options) : String(n)
}

/**
 * Formats a duration for humans. Takes any `Duration.Input` (a `Duration`,
 * milliseconds, `"90 minutes"`, ...). Styles:
 *
 * - `"narrow"` (default): `"0d 1h 30m 0s 0ms 0µs 0ns"`
 * - `"full"`: `"0 days, 1 hour, 30 minutes, ..."`
 * - `"digital"`: `"00:01:30:00:000:000:000"`
 *
 * `ignoreZero` drops zero parts. Negative durations are formatted by their
 * magnitude; infinite ones as `"Infinity"`.
 */
export const formatDuration = (duration: Duration.Input, options?: DurationOptions): string => {
  const nanos = Duration.toNanos(Duration.fromInputUnsafe(duration))
  return Option.match(nanos, {
    onNone: () => "Infinity",
    onSome: (n) => stdDuration(Number(n < 0n ? -n : n) / 1e6, options),
  })
}

/**
 * Formats arguments with a printf-style format string: `%s`, `%d`, `%f`,
 * `%x`, `%o`, `%b`, `%e`, `%g`, `%c`, `%q`, `%t`, `%T`, `%v`, `%j`, with
 * flags, width, precision and `%[n]` argument indexes.
 */
export const sprintf = (format: string, ...args: ReadonlyArray<unknown>): string => stdSprintf(format, ...args)
