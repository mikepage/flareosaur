// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * Parses and stringifies `.env` text, and serves it as Effect `Config`.
 *
 * Workers have no filesystem and no `process.env`, so a `.env` file arrives
 * as text: a binding, a KV value, an embedded asset. This module parses it
 * with `@std/dotenv`'s parser (quoting, multi-line values, `export`, and
 * `$VAR` / `${VAR:-default}` expansion in unquoted values), reports invalid
 * keys as a typed {@linkcode DotenvError} instead of a console warning, and
 * turns the result into a `ConfigProvider` so `Config.String("PORT")` reads
 * from it.
 *
 * Effect's own `ConfigProvider.fromDotEnvContents` uses the `dotenv`
 * package's rules and expands variables only on request; use this module
 * when you want std's semantics or the parsed record itself.
 *
 * ```ts
 * import { Config, Effect } from "effect"
 * import * as Dotenv from "@mikepage/flareosaur/dotenv"
 *
 * const program = Effect.gen(function*() {
 *   const port = yield* Config.Port("PORT")
 *   const url = yield* Config.String("URL")
 *   return { port, url } // { port: 8080, url: "http://localhost:8080" }
 * }).pipe(Effect.provide(Dotenv.layer("PORT=8080\nURL=http://localhost:$PORT\n")))
 * ```
 *
 * @module
 */

import { ConfigProvider, Effect, Layer, Schema } from "effect"
import { parse as stdParse } from "./_std/parse.ts"
import { stringify as stdStringify } from "./_std/stringify.ts"

/** A key is not a valid identifier, or a value is not a string. */
export class DotenvError extends Schema.TaggedError<DotenvError>()("DotenvError", {
  kind: Schema.Literals(["InvalidKey", "InvalidValue"]),
  key: Schema.String,
  message: Schema.String,
}) {}

// The line pattern of std's parser (./_std/parse.ts), used to find the keys
// it would reject before handing the text over.
const KEY_VALUE_REGEXP =
  /^\s*(?:export\s+)?(?<key>[^\s=#]+?)\s*=[\ \t]*('\r?\n?(?<notInterpolated>(.|\r\n|\n)*?)\r?\n?'|"\r?\n?(?<interpolated>(?:[^"\\]|\\[\s\S])*?)\r?\n?"|(?<unquoted>[^\r\n#]*)) *#*.*$/gm

const VALID_KEY_REGEXP = /^[a-zA-Z_][a-zA-Z0-9_]*$/

const invalidKey = (key: string) =>
  new DotenvError({
    kind: "InvalidKey",
    key,
    message: `The key "${key}" is not a valid identifier: keys must match ${VALID_KEY_REGEXP}`,
  })

/** Options for {@linkcode parse}. */
export interface ParseOptions {
  /**
   * What to do with a key that is not a valid identifier, such as `1KEY`:
   * fail with a {@linkcode DotenvError} (the default), or skip the line.
   */
  readonly invalidKeys?: "fail" | "ignore" | undefined
}

/**
 * Parses `.env` text into a record of strings.
 *
 * Values may be unquoted, `'single quoted'` (taken literally, may span
 * lines) or `"double quoted"` (with `\n`, `\r`, `\t` escapes). Unquoted
 * values expand `$VAR`, `${VAR}` and `${VAR:-default}`. Lines starting with
 * `#` are comments; an `export ` prefix is ignored.
 */
export const parse = (text: string, options?: ParseOptions): Effect.Effect<Record<string, string>, DotenvError> =>
  Effect.suspend(() => {
    let source = text
    for (const match of [...text.matchAll(KEY_VALUE_REGEXP)].reverse()) {
      const key = match.groups!.key!
      if (VALID_KEY_REGEXP.test(key)) continue
      if (options?.invalidKeys !== "ignore") return Effect.fail(invalidKey(key))
      source = source.slice(0, match.index) + source.slice(match.index + match[0].length)
    }
    return Effect.succeed(stdParse(source))
  })

/**
 * Stringifies a record as `.env` text, one `KEY=value` line per entry.
 * Values are quoted and escaped so that {@linkcode parse} reads them back
 * unchanged. Fails when a key is not a valid identifier or a value is not a
 * string.
 */
export const stringify = (record: Readonly<Record<string, string>>): Effect.Effect<string, DotenvError> =>
  Effect.suspend(() => {
    for (const [key, value] of Object.entries(record)) {
      if (!VALID_KEY_REGEXP.test(key)) return Effect.fail(invalidKey(key))
      if (typeof value !== "string") {
        return Effect.fail(
          new DotenvError({ kind: "InvalidValue", key, message: `The value of "${key}" is not a string` }),
        )
      }
    }
    return Effect.succeed(stdStringify(record))
  })

/** Options for {@linkcode configProvider} and {@linkcode layer}. */
export interface ConfigProviderOptions extends ParseOptions {
  /** Keep `KEY=` as an empty string instead of treating it as missing. */
  readonly preserveEmptyStrings?: boolean | undefined
}

/**
 * Parses `.env` text into a `ConfigProvider`. Keys follow the environment
 * variable conventions of `ConfigProvider.fromEnvRecord`: `DB_HOST` is found
 * at `["DB_HOST"]` and at `["DB", "HOST"]`, so `Config.nested` works.
 */
export const configProvider = (
  text: string,
  options?: ConfigProviderOptions,
): Effect.Effect<ConfigProvider.ConfigProvider, DotenvError> =>
  Effect.map(
    parse(text, options),
    (env) => ConfigProvider.fromEnvRecord(env, { preserveEmptyStrings: options?.preserveEmptyStrings }),
  )

/** A layer that makes `.env` text the `ConfigProvider`, replacing the current one. */
export const layer = (text: string, options?: ConfigProviderOptions): Layer.Layer<never, DotenvError> =>
  ConfigProvider.layer(configProvider(text, options))

/** Options for {@linkcode layerAdd}. */
export interface LayerAddOptions extends ConfigProviderOptions {
  /** Consult the `.env` values before the current provider instead of after it. */
  readonly asPrimary?: boolean | undefined
}

/**
 * A layer that adds `.env` text to the current `ConfigProvider`: as a
 * fallback for missing values by default, or in front of it with
 * `asPrimary: true`.
 */
export const layerAdd = (text: string, options?: LayerAddOptions): Layer.Layer<never, DotenvError> =>
  ConfigProvider.layerAdd(configProvider(text, options), { asPrimary: options?.asPrimary })
