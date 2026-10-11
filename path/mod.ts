// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * Path manipulation for Workers, built on Effect's `Path` service.
 *
 * Effect's `Path` service is the platform-neutral interface; write code
 * against it and provide a layer. {@linkcode layerPosix} (also
 * {@linkcode layer}) and {@linkcode layerWindows} implement it with
 * `@std/path`'s POSIX and Windows code. File URL conversion fails with
 * `BadArgument` for relative paths.
 *
 * Workers have no current working directory. Effect's built-in
 * `Path.layer` reads `process.cwd()` to resolve a relative path, and throws
 * on Workers, where `process` does not exist. The layers here resolve
 * relative paths against `/` (POSIX) or `C:\` (Windows) instead, or against
 * a directory you choose with {@linkcode Posix.layerWith} /
 * {@linkcode Windows.layerWith}.
 *
 * The functions exported here are the POSIX ones, as `@std/path` picks on a
 * POSIX platform, including what Effect's `Path` lacks: {@linkcode common},
 * {@linkcode globToRegExp}, {@linkcode isGlob}, {@linkcode joinGlobs} and
 * {@linkcode normalizeGlob}. {@linkcode Posix} and {@linkcode Windows} hold
 * both flavours explicitly (also at `path/posix` and `path/windows`).
 *
 * ```ts
 * import { Effect } from "effect"
 * import * as Path from "@mikepage/flareosaur/path"
 *
 * Path.join("a", "b", "../c") // "a/c"
 * Path.globToRegExp("*.ts").test("mod.ts") // true
 * Path.Windows.basename("C:\\dir\\file.txt") // "file.txt"
 *
 * const program = Effect.gen(function*() {
 *   const path = yield* Path.Path
 *   const url = yield* path.toFileUrl("/srv/www/index.html")
 *   return url.href // "file:///srv/www/index.html"
 * }).pipe(Effect.provide(Path.layerPosix))
 * ```
 *
 * @module
 */

import { type Layer, Path as EffectPath } from "effect"
import * as Posix from "./Posix.ts"
import * as Windows from "./Windows.ts"

export { Posix, Windows }

export {
  basename,
  common,
  DELIMITER,
  dirname,
  extname,
  format,
  fromFileUrl,
  type GlobOptions,
  globToRegExp,
  isAbsolute,
  isGlob,
  join,
  joinGlobs,
  normalize,
  normalizeGlob,
  parse,
  type ParsedPath,
  relative,
  resolve,
  SEPARATOR,
  SEPARATOR_PATTERN,
  toFileUrl,
  toNamespacedPath,
} from "./Posix.ts"

/** Effect's `Path` service: `yield* Path.Path` in an Effect to use it. */
export const Path: typeof EffectPath.Path = EffectPath.Path

/** The `Path` service interface. */
export type Path = EffectPath.Path

/** The `Path` service with `@std/path`'s POSIX implementation, resolving against `/`. */
export const layerPosix: Layer.Layer<Path> = Posix.layer

/**
 * The default `Path` layer for Workers: {@linkcode layerPosix}. Use it
 * instead of Effect's `Path.layer`, whose `resolve` throws on Workers for
 * relative paths.
 */
export const layer: Layer.Layer<Path> = layerPosix

/** The `Path` service with `@std/path`'s Windows implementation, resolving against `C:\`. */
export const layerWindows: Layer.Layer<Path> = Windows.layer
