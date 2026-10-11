// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * ANSI terminal colors and styles, with an Effect-friendly `NO_COLOR`.
 *
 * The style functions (`red`, `bold`, `bgRgb24`, ...) are std's
 * `@std/fmt/colors`, as pure functions that always emit ANSI codes. Instead
 * of std's global `setColorEnabled`, color is switched off per Effect with
 * the {@linkcode NoColor} reference: read the {@linkcode palette} inside an
 * Effect and you get the same functions, or identity functions when
 * `NoColor` is `true`. {@linkcode layerNoColorFromEnv} sets `NoColor` from
 * the `NO_COLOR` environment variable (https://no-color.org) via `Config`.
 *
 * ```ts
 * import { Console, Effect } from "effect"
 * import * as Colors from "@mikepage/flareosaur/fmt/colors"
 *
 * Colors.red("error") // "\x1b[31merror\x1b[39m"
 *
 * const program = Effect.gen(function*() {
 *   const c = yield* Colors.palette
 *   yield* Console.log(c.bold(c.green("ok")))
 * })
 *
 * Effect.runPromise(program.pipe(Colors.withNoColor(true))) // logs "ok"
 * ```
 *
 * @module
 */

import { Config, Context, Effect, Layer, Option } from "effect"
import * as std from "./_std/colors.ts"

export {
  bgBlack,
  bgBlue,
  bgBrightBlack,
  bgBrightBlue,
  bgBrightCyan,
  bgBrightGreen,
  bgBrightMagenta,
  bgBrightRed,
  bgBrightWhite,
  bgBrightYellow,
  bgCyan,
  bgGreen,
  bgMagenta,
  bgRed,
  bgRgb24,
  bgRgb8,
  bgWhite,
  bgYellow,
  black,
  blue,
  bold,
  brightBlack,
  brightBlue,
  brightCyan,
  brightGreen,
  brightMagenta,
  brightRed,
  brightWhite,
  brightYellow,
  cyan,
  dim,
  gray,
  green,
  hidden,
  inverse,
  italic,
  magenta,
  red,
  reset,
  rgb24,
  rgb8,
  type Rgb,
  strikethrough,
  stripAnsiCode,
  underline,
  white,
  yellow,
} from "./_std/colors.ts"

const STYLES = [
  "reset",
  "bold",
  "dim",
  "italic",
  "underline",
  "inverse",
  "hidden",
  "strikethrough",
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "gray",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
  "bgBlack",
  "bgRed",
  "bgGreen",
  "bgYellow",
  "bgBlue",
  "bgMagenta",
  "bgCyan",
  "bgWhite",
  "bgBrightBlack",
  "bgBrightRed",
  "bgBrightGreen",
  "bgBrightYellow",
  "bgBrightBlue",
  "bgBrightMagenta",
  "bgBrightCyan",
  "bgBrightWhite",
] as const

/** The name of a style that takes only the text. */
export type Style = typeof STYLES[number]

/** Every style function, as returned by {@linkcode palette}. */
export type Palette =
  & { readonly [K in Style]: (text: string) => string }
  & {
    readonly rgb8: (text: string, color: number) => string
    readonly bgRgb8: (text: string, color: number) => string
    readonly rgb24: (text: string, color: number | std.Rgb) => string
    readonly bgRgb24: (text: string, color: number | std.Rgb) => string
  }

/** The palette that emits ANSI codes. */
export const colored: Palette = {
  ...(Object.fromEntries(STYLES.map((name) => [name, std[name]])) as { [K in Style]: (text: string) => string }),
  rgb8: std.rgb8,
  bgRgb8: std.bgRgb8,
  rgb24: std.rgb24,
  bgRgb24: std.bgRgb24,
}

const identity = (text: string) => text

/** The palette that returns text unchanged. */
export const plain: Palette = {
  ...(Object.fromEntries(STYLES.map((name) => [name, identity])) as { [K in Style]: (text: string) => string }),
  rgb8: identity,
  bgRgb8: identity,
  rgb24: identity,
  bgRgb24: identity,
}

/** Whether color is switched off. Defaults to `false`. */
export const NoColor: Context.Reference<boolean> = Context.Reference<boolean>("flareosaur/fmt/Colors/NoColor", {
  defaultValue: () => false,
})

/** The palette for the current {@linkcode NoColor} setting. */
export const palette: Effect.Effect<Palette> = Effect.gen(function*() {
  return (yield* NoColor) ? plain : colored
})

/** Runs an Effect with color switched off (`true`) or on (`false`). */
export const withNoColor =
  (noColor: boolean) => <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.provideService(self, NoColor, noColor)

/**
 * Sets {@linkcode NoColor} from the `NO_COLOR` environment variable: color is
 * off when it is present and not empty.
 */
export const layerNoColorFromEnv: Layer.Layer<never, Config.ConfigError> = Layer.effect(
  NoColor,
  Effect.gen(function*() {
    const value = yield* Config.option(Config.String("NO_COLOR"))
    return Option.exists(value, (v) => v !== "")
  }),
)
