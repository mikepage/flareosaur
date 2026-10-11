// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * POSIX paths (`/` separated), as pure functions and as an Effect `Path`
 * service.
 *
 * This is `@std/path/posix` for Workers: the path functions, `common`, and
 * the glob helpers (`globToRegExp`, `isGlob`, `joinGlobs`,
 * `normalizeGlob`) that Effect's `Path` lacks. File URL conversion returns
 * an `Effect` that fails with `PlatformError.BadArgument` instead of
 * throwing. {@linkcode layer} provides these functions as Effect's
 * `Path.Path` service.
 *
 * Workers have no current working directory. {@linkcode resolve} and
 * {@linkcode relative} resolve relative paths against `/`; build a service
 * with another directory with {@linkcode make} or {@linkcode layerWith}.
 *
 * ```ts
 * import { Effect, Path } from "effect"
 * import * as Posix from "@mikepage/flareosaur/path/posix"
 *
 * Posix.join("/a", "b", "../c") // "/a/c"
 * Posix.resolve("a", "b") // "/a/b"
 * Posix.globToRegExp("*.ts").test("mod.ts") // true
 *
 * const program = Effect.gen(function*() {
 *   const path = yield* Path.Path
 *   return path.resolve("src") // "/app/src"
 * }).pipe(Effect.provide(Posix.layerWith({ cwd: "/app" })))
 * ```
 *
 * @module
 */

import { Effect, Layer, Path, type PlatformError } from "effect"
import { attempt, makeService } from "./_internal.ts"
import { basename as stdBasename } from "./_std/posix/basename.ts"
import { common as stdCommon } from "./_std/posix/common.ts"
import {
  DELIMITER as STD_DELIMITER,
  SEPARATOR as STD_SEPARATOR,
  SEPARATOR_PATTERN as STD_SEPARATOR_PATTERN,
} from "./_std/posix/constants.ts"
import { dirname as stdDirname } from "./_std/posix/dirname.ts"
import { extname as stdExtname } from "./_std/posix/extname.ts"
import { format as stdFormat } from "./_std/posix/format.ts"
import { fromFileUrl as stdFromFileUrl } from "./_std/posix/from_file_url.ts"
import { type GlobOptions, globToRegExp as stdGlobToRegExp } from "./_std/posix/glob_to_regexp.ts"
import { isAbsolute as stdIsAbsolute } from "./_std/posix/is_absolute.ts"
import { isGlob as stdIsGlob } from "./_std/posix/is_glob.ts"
import { join as stdJoin } from "./_std/posix/join.ts"
import { joinGlobs as stdJoinGlobs } from "./_std/posix/join_globs.ts"
import { normalize as stdNormalize } from "./_std/posix/normalize.ts"
import { normalizeGlob as stdNormalizeGlob } from "./_std/posix/normalize_glob.ts"
import { parse as stdParse } from "./_std/posix/parse.ts"
import { relative as stdRelative } from "./_std/posix/relative.ts"
import { resolve as stdResolve } from "./_std/posix/resolve.ts"
import { toFileUrl as stdToFileUrl } from "./_std/posix/to_file_url.ts"

export type { GlobOptions }

/** The parts of a path, as returned by {@linkcode parse}. */
export type ParsedPath = Path.Path.Parsed

/** The path separator, `/`. */
export const SEPARATOR: "/" = STD_SEPARATOR

/** The `PATH` list delimiter, `:`. */
export const DELIMITER: ":" = STD_DELIMITER

/** Matches one or more path separators. */
export const SEPARATOR_PATTERN: RegExp = STD_SEPARATOR_PATTERN

/** The directory relative paths resolve against when none is given: `/`. */
export const DEFAULT_CWD = "/"

/**
 * The last segment of a path, without trailing separators, and without
 * `suffix` if it ends with it.
 *
 * ```ts
 * import * as Posix from "@mikepage/flareosaur/path/posix"
 *
 * Posix.basename("/home/user/mod.ts", ".ts") // "mod"
 * ```
 */
export const basename = (path: string, suffix?: string): string => stdBasename(path, suffix)

/** The directory part of a path: `dirname("/a/b/c")` is `"/a/b"`. */
export const dirname = (path: string): string => stdDirname(path)

/** The extension of a path, from the last `.`: `extname("a/b.ts")` is `".ts"`. */
export const extname = (path: string): string => stdExtname(path)

/** Builds a path from its parts; the inverse of {@linkcode parse}. */
export const format = (pathObject: Partial<ParsedPath>): string => stdFormat(pathObject)

/** Whether a path is absolute (starts with `/`). */
export const isAbsolute = (path: string): boolean => stdIsAbsolute(path)

/** Joins segments with `/` and normalizes the result. No segments give `"."`. */
export const join = (...paths: ReadonlyArray<string>): string => paths.length === 0 ? "." : stdJoin(...paths)

/** Normalizes a path, resolving `..` and `.` segments and repeated separators. */
export const normalize = (path: string): string => stdNormalize(path)

/** Splits a path into `root`, `dir`, `base`, `ext` and `name`. */
export const parse = (path: string): ParsedPath => stdParse(path)

/** On POSIX, returns the path unchanged. */
export const toNamespacedPath = (path: string): string => path

const resolveFrom = (cwd: string) => (...pathSegments: ReadonlyArray<string>): string =>
  stdResolve(DEFAULT_CWD, cwd, ...pathSegments)

/**
 * Resolves segments, right to left, into an absolute path. Relative results
 * are resolved against `/` ({@linkcode DEFAULT_CWD}), since Workers have no
 * working directory.
 *
 * ```ts
 * import * as Posix from "@mikepage/flareosaur/path/posix"
 *
 * Posix.resolve("/foo", "bar", "../baz") // "/foo/baz"
 * Posix.resolve("a") // "/a"
 * ```
 */
export const resolve: (...pathSegments: ReadonlyArray<string>) => string = resolveFrom(DEFAULT_CWD)

const relativeFrom = (cwd: string) => (from: string, to: string): string => {
  const resolve = resolveFrom(cwd)
  return stdRelative(resolve(from), resolve(to))
}

/**
 * The relative path from `from` to `to`, both resolved with
 * {@linkcode resolve} first.
 *
 * ```ts
 * import * as Posix from "@mikepage/flareosaur/path/posix"
 *
 * Posix.relative("/data/a/b", "/data/c") // "../../c"
 * ```
 */
export const relative: (from: string, to: string) => string = relativeFrom(DEFAULT_CWD)

/**
 * The longest common directory of a list of paths, with a trailing `/`, or
 * `""` when they share none.
 *
 * ```ts
 * import * as Posix from "@mikepage/flareosaur/path/posix"
 *
 * Posix.common(["/a/b/c.ts", "/a/b/d.ts", "/a/e"]) // "/a/"
 * ```
 */
export const common = (paths: ReadonlyArray<string>): string => stdCommon([...paths])

/**
 * Converts a `file:` URL to a path. Fails with `BadArgument` for other
 * schemes and strings that are not URLs.
 *
 * ```ts
 * import { Effect } from "effect"
 * import * as Posix from "@mikepage/flareosaur/path/posix"
 *
 * Effect.runSync(Posix.fromFileUrl("file:///home/foo")) // "/home/foo"
 * ```
 */
export const fromFileUrl = (url: URL | string): Effect.Effect<string, PlatformError.BadArgument> =>
  attempt("fromFileUrl", () => stdFromFileUrl(url))

/**
 * Converts an absolute path to a `file:` URL, percent-encoding what needs
 * it. Fails with `BadArgument` for relative paths.
 *
 * ```ts
 * import { Effect } from "effect"
 * import * as Posix from "@mikepage/flareosaur/path/posix"
 *
 * Effect.runSync(Posix.toFileUrl("/home/foo")).href // "file:///home/foo"
 * ```
 */
export const toFileUrl = (path: string): Effect.Effect<URL, PlatformError.BadArgument> =>
  attempt("toFileUrl", () => stdToFileUrl(path))

/**
 * Converts a glob to a regular expression matching POSIX paths. Supports
 * `*`, `?`, `**` (with `globstar`), character classes, and extended globs
 * (`{a,b}`, `?(x)`, `+(x)`, `@(x)`, `!(x)`) with `extended`.
 *
 * ```ts
 * import * as Posix from "@mikepage/flareosaur/path/posix"
 *
 * Posix.globToRegExp("src/*.{ts,js}").test("src/mod.ts") // true
 * ```
 */
export const globToRegExp = (glob: string, options?: GlobOptions): RegExp => stdGlobToRegExp(glob, options)

/**
 * Whether a string contains glob syntax.
 *
 * ```ts
 * import * as Posix from "@mikepage/flareosaur/path/posix"
 *
 * Posix.isGlob("*.ts") // true
 * Posix.isGlob("mod.ts") // false
 * ```
 */
export const isGlob = (str: string): boolean => stdIsGlob(str)

/** Joins globs and normalizes the result like {@linkcode normalizeGlob}. */
export const joinGlobs = (globs: ReadonlyArray<string>, options?: Pick<GlobOptions, "globstar">): string =>
  stdJoinGlobs([...globs], options)

/** Normalizes a glob like {@linkcode normalize}, keeping `**` when `globstar` is set. */
export const normalizeGlob = (glob: string, options?: Pick<GlobOptions, "globstar">): string =>
  stdNormalizeGlob(glob, options)

/** Options for {@linkcode make} and {@linkcode layerWith}. */
export interface Options {
  /**
   * The directory relative paths resolve against. Defaults to `/`. A
   * relative directory is itself resolved against `/`.
   */
  readonly cwd?: string | undefined
}

/**
 * Builds Effect's `Path` service from the POSIX functions, resolving
 * relative paths against `options.cwd`.
 */
export const make = (options?: Options): Path.Path => {
  const cwd = options?.cwd ?? DEFAULT_CWD
  return makeService({
    sep: SEPARATOR,
    basename,
    dirname,
    extname,
    format,
    fromFileUrl: stdFromFileUrl,
    isAbsolute,
    join,
    normalize,
    parse,
    relative: relativeFrom(cwd),
    resolve: resolveFrom(cwd),
    toFileUrl: stdToFileUrl,
    toNamespacedPath,
  })
}

/** Provides Effect's `Path` service with POSIX paths, resolving against `/`. */
export const layer: Layer.Layer<Path.Path> = Layer.succeed(Path.Path)(make())

/** Provides Effect's `Path` service with POSIX paths and the given options. */
export const layerWith = (options: Options): Layer.Layer<Path.Path> => Layer.succeed(Path.Path)(make(options))
