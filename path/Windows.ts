// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * Windows paths (`\` separated, drive letters and UNC shares), as pure
 * functions and as an Effect `Path` service.
 *
 * This is `@std/path/windows` for Workers, for code that handles Windows
 * paths on any platform: the path functions, `common`, and the glob helpers
 * that Effect's `Path` lacks. File URL conversion returns an `Effect` that
 * fails with `PlatformError.BadArgument` instead of throwing.
 * {@linkcode layer} provides these functions as Effect's `Path.Path`
 * service.
 *
 * Workers have no current working directory. {@linkcode resolve},
 * {@linkcode relative} and {@linkcode toNamespacedPath} resolve relative
 * paths against `C:\` ({@linkcode DEFAULT_CWD}); a path on another drive
 * (`D:foo`) resolves against that drive's root. Build a service with another
 * directory with {@linkcode make} or {@linkcode layerWith}.
 *
 * ```ts
 * import * as Windows from "@mikepage/flareosaur/path/windows"
 *
 * Windows.join("C:\\a", "b", "..\\c") // "C:\\a\\c"
 * Windows.resolve("foo") // "C:\\foo"
 * Windows.parse("C:\\a\\b.txt").name // "b"
 * ```
 *
 * @module
 */

import { Effect, Layer, Path, type PlatformError } from "effect"
import { attempt, makeService } from "./_internal.ts"
import { basename as stdBasename } from "./_std/windows/basename.ts"
import { common as stdCommon } from "./_std/windows/common.ts"
import {
  DELIMITER as STD_DELIMITER,
  SEPARATOR as STD_SEPARATOR,
  SEPARATOR_PATTERN as STD_SEPARATOR_PATTERN,
} from "./_std/windows/constants.ts"
import { dirname as stdDirname } from "./_std/windows/dirname.ts"
import { extname as stdExtname } from "./_std/windows/extname.ts"
import { format as stdFormat } from "./_std/windows/format.ts"
import { fromFileUrl as stdFromFileUrl } from "./_std/windows/from_file_url.ts"
import type { GlobOptions } from "./_std/_common/glob_to_reg_exp.ts"
import { globToRegExp as stdGlobToRegExp } from "./_std/windows/glob_to_regexp.ts"
import { isAbsolute as stdIsAbsolute } from "./_std/windows/is_absolute.ts"
import { isGlob as stdIsGlob } from "./_std/windows/is_glob.ts"
import { join as stdJoin } from "./_std/windows/join.ts"
import { joinGlobs as stdJoinGlobs } from "./_std/windows/join_globs.ts"
import { normalize as stdNormalize } from "./_std/windows/normalize.ts"
import { normalizeGlob as stdNormalizeGlob } from "./_std/windows/normalize_glob.ts"
import { parse as stdParse } from "./_std/windows/parse.ts"
import { relative as stdRelative } from "./_std/windows/relative.ts"
import { resolve as stdResolve } from "./_std/windows/resolve.ts"
import { toFileUrl as stdToFileUrl } from "./_std/windows/to_file_url.ts"
import { toNamespacedPath as stdToNamespacedPath } from "./_std/windows/to_namespaced_path.ts"

export type { GlobOptions }

/** The parts of a path, as returned by {@linkcode parse}. */
export type ParsedPath = Path.Path.Parsed

/** The path separator, `\`. */
export const SEPARATOR: "\\" = STD_SEPARATOR

/** The `PATH` list delimiter, `;`. */
export const DELIMITER: ";" = STD_DELIMITER

/** Matches one or more path separators (`\` or `/`). */
export const SEPARATOR_PATTERN: RegExp = STD_SEPARATOR_PATTERN

/** The directory relative paths resolve against when none is given: `C:\`. */
export const DEFAULT_CWD = "C:\\"

/** The last segment of a path, without `suffix` if it ends with it. */
export const basename = (path: string, suffix?: string): string => stdBasename(path, suffix)

/** The directory part of a path: `dirname("C:\\a\\b")` is `"C:\\a"`. */
export const dirname = (path: string): string => stdDirname(path)

/** The extension of a path, from the last `.`. */
export const extname = (path: string): string => stdExtname(path)

/** Builds a path from its parts; the inverse of {@linkcode parse}. */
export const format = (pathObject: Partial<ParsedPath>): string => stdFormat(pathObject)

/** Whether a path is absolute (`C:\...`, `\...` or a UNC path). */
export const isAbsolute = (path: string): boolean => stdIsAbsolute(path)

/** Joins segments with `\` and normalizes the result. No segments give `"."`. */
export const join = (...paths: ReadonlyArray<string>): string => paths.length === 0 ? "." : stdJoin(...paths)

/** Normalizes a path, resolving `..` and `.` segments and repeated separators. */
export const normalize = (path: string): string => stdNormalize(path)

/** Splits a path into `root`, `dir`, `base`, `ext` and `name`. */
export const parse = (path: string): ParsedPath => stdParse(path)

const DRIVE = /^([A-Za-z]:)/

const resolveFrom = (cwd: string) => {
  const base = stdResolve(DEFAULT_CWD, cwd)
  return (...pathSegments: ReadonlyArray<string>): string => {
    // std falls back to the process's working directory; resolve against
    // `base`, or against the root of the drive the segments name when it is
    // another drive (what Windows does for a drive without a remembered cwd).
    let root = base
    for (let i = pathSegments.length - 1; i >= 0; i--) {
      const drive = DRIVE.exec(pathSegments[i]!)?.[1]
      if (drive !== undefined) {
        if (drive.toLowerCase() !== base.slice(0, 2).toLowerCase()) root = `${drive}\\`
        break
      }
    }
    return stdResolve(root, ...pathSegments)
  }
}

/**
 * Resolves segments, right to left, into an absolute path. Relative results
 * resolve against `C:\` ({@linkcode DEFAULT_CWD}), since Workers have no
 * working directory.
 *
 * ```ts
 * import * as Windows from "@mikepage/flareosaur/path/windows"
 *
 * Windows.resolve("c:/ignore", "c:/some/file") // "c:\\some\\file"
 * Windows.resolve("d:foo") // "d:\\foo"
 * ```
 */
export const resolve: (...pathSegments: ReadonlyArray<string>) => string = resolveFrom(DEFAULT_CWD)

const relativeFrom = (cwd: string) => {
  const resolve = resolveFrom(cwd)
  return (from: string, to: string): string => stdRelative(resolve(from), resolve(to))
}

/**
 * The relative path from `from` to `to`, both resolved with
 * {@linkcode resolve} first.
 *
 * ```ts
 * import * as Windows from "@mikepage/flareosaur/path/windows"
 *
 * Windows.relative("C:\\orandea\\test\\aaa", "C:\\orandea\\impl\\bbb") // "..\\..\\impl\\bbb"
 * ```
 */
export const relative: (from: string, to: string) => string = relativeFrom(DEFAULT_CWD)

const toNamespacedPathFrom = (cwd: string) => {
  const resolve = resolveFrom(cwd)
  return (path: string): string => {
    if (path.length === 0) return ""
    const resolved = resolve(path)
    const namespaced = stdToNamespacedPath(resolved)
    return namespaced === resolved ? path : namespaced
  }
}

/**
 * The long (`\\?\`) form of a path, resolved with {@linkcode resolve}.
 *
 * ```ts
 * import * as Windows from "@mikepage/flareosaur/path/windows"
 *
 * Windows.toNamespacedPath("C:\\foo") // "\\\\?\\C:\\foo"
 * ```
 */
export const toNamespacedPath: (path: string) => string = toNamespacedPathFrom(DEFAULT_CWD)

/**
 * The longest common directory of a list of paths, with a trailing `\`, or
 * `""` when they share none.
 */
export const common = (paths: ReadonlyArray<string>): string => stdCommon([...paths])

/**
 * Converts a `file:` URL to a path; a URL host becomes a UNC share. Fails
 * with `BadArgument` for other schemes and strings that are not URLs.
 *
 * ```ts
 * import { Effect } from "effect"
 * import * as Windows from "@mikepage/flareosaur/path/windows"
 *
 * Effect.runSync(Windows.fromFileUrl("file:///C:/home/foo")) // "C:\\home\\foo"
 * ```
 */
export const fromFileUrl = (url: URL | string): Effect.Effect<string, PlatformError.BadArgument> =>
  attempt("fromFileUrl", () => stdFromFileUrl(url))

/**
 * Converts an absolute path to a `file:` URL. Fails with `BadArgument` for
 * relative paths and invalid UNC hosts.
 *
 * ```ts
 * import { Effect } from "effect"
 * import * as Windows from "@mikepage/flareosaur/path/windows"
 *
 * Effect.runSync(Windows.toFileUrl("C:\\home\\foo")).href // "file:///C:/home/foo"
 * ```
 */
export const toFileUrl = (path: string): Effect.Effect<URL, PlatformError.BadArgument> =>
  attempt("toFileUrl", () => stdToFileUrl(path))

/** Converts a glob to a regular expression matching Windows paths (`\` or `/`). */
export const globToRegExp = (glob: string, options?: GlobOptions): RegExp => stdGlobToRegExp(glob, options)

/** Whether a string contains glob syntax. */
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
   * The directory relative paths resolve against. Defaults to `C:\`. A
   * relative directory is itself resolved against `C:\`.
   */
  readonly cwd?: string | undefined
}

/**
 * Builds Effect's `Path` service from the Windows functions, resolving
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
    toNamespacedPath: toNamespacedPathFrom(cwd),
  })
}

/** Provides Effect's `Path` service with Windows paths, resolving against `C:\`. */
export const layer: Layer.Layer<Path.Path> = Layer.succeed(Path.Path)(make())

/** Provides Effect's `Path` service with Windows paths and the given options. */
export const layerWith = (options: Options): Layer.Layer<Path.Path> => Layer.succeed(Path.Path)(make(options))
