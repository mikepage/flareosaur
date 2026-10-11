// Copyright 2026 the flareosaur authors. MIT license.
// Shared plumbing for Posix.ts and Windows.ts: std's throwing URL helpers as
// Effects failing with BadArgument, and the Path service built from std.

import { Effect, Path, PlatformError } from "effect"

export const badArgument = (method: string, cause: unknown): PlatformError.BadArgument =>
  new PlatformError.BadArgument({
    module: "Path",
    method,
    description: cause instanceof Error ? cause.message : String(cause),
    cause,
  })

export const attempt = <A>(method: string, f: () => A): Effect.Effect<A, PlatformError.BadArgument> =>
  Effect.try({ try: f, catch: (cause) => badArgument(method, cause) })

export interface Flavour {
  readonly sep: string
  readonly basename: (path: string, suffix?: string) => string
  readonly dirname: (path: string) => string
  readonly extname: (path: string) => string
  readonly format: (pathObject: Partial<Path.Path.Parsed>) => string
  readonly fromFileUrl: (url: URL | string) => string
  readonly isAbsolute: (path: string) => boolean
  readonly join: (...paths: Array<string>) => string
  readonly normalize: (path: string) => string
  readonly parse: (path: string) => Path.Path.Parsed
  readonly relative: (from: string, to: string) => string
  readonly resolve: (...pathSegments: Array<string>) => string
  readonly toFileUrl: (path: string) => URL
  readonly toNamespacedPath: (path: string) => string
}

export const makeService = (flavour: Flavour): Path.Path =>
  Path.Path.of({
    [Path.TypeId]: Path.TypeId,
    sep: flavour.sep,
    basename: (path, suffix) => flavour.basename(path, suffix),
    dirname: flavour.dirname,
    extname: flavour.extname,
    format: flavour.format,
    fromFileUrl: (url) => attempt("fromFileUrl", () => flavour.fromFileUrl(url)),
    isAbsolute: flavour.isAbsolute,
    join: (...paths) => flavour.join(...paths),
    normalize: flavour.normalize,
    parse: flavour.parse,
    relative: flavour.relative,
    resolve: (...segments) => flavour.resolve(...segments),
    toFileUrl: (path) => attempt("toFileUrl", () => flavour.toFileUrl(path)),
    toNamespacedPath: flavour.toNamespacedPath,
  })
