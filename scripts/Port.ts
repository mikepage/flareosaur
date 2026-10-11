// Copyright 2026 the flareosaur authors. MIT license.
// Vendors std code into `<dir>/_std/`. Imports between std packages become
// relative paths to the other package's `_std/`, crypto's inline wasm becomes
// a `.wasm` module import, and patches/*.patch are applied on top.

import { Effect, FileSystem, Path, Schema, String } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { STD_PACKAGES, type StdPackage } from "./Packages.ts"

export const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "")

export class PortError extends Schema.TaggedError<PortError>()("PortError", {
  message: Schema.String,
}) {}

const TEXT = /\.(ts|mts|mjs|js|md)$/
const SPECIFIER = /(["'])(@std\/[a-z0-9_-]+(?:\/[a-z0-9_-]+)?)\1/g

const skip = (rel: string, opts: StdPackage): boolean => {
  if (rel === "deno.json") return true
  if (opts.only) return !opts.only.includes(rel)
  if (/(^|\/)(_benches?|_tools)\//.test(rel) || /_bench\.ts$/.test(rel)) return true
  return (opts.exclude ?? []).some((e) => e.endsWith("/") ? rel.startsWith(e) : rel === e)
}

/** Lists files below `dir`, relative to it. */
export const walk = Effect.fnUntraced(function*(dir: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const entries = yield* fs.readDirectory(dir, { recursive: true })
  const files: Array<string> = []
  for (const entry of entries) {
    const info = yield* fs.stat(path.join(dir, entry))
    if (info.type === "File") files.push(entry)
  }
  return files.sort()
})

interface StdIndex {
  /** `@std/<name>[/<sub>]` -> [directory, file within the package] */
  readonly specifiers: ReadonlyMap<string, readonly [string, string]>
  /** std package name -> directory */
  readonly dirs: ReadonlyMap<string, string>
}

const indexStd = Effect.fnUntraced(function*(std: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const specifiers = new Map<string, readonly [string, string]>()
  const dirs = new Map<string, string>()
  for (const dir of Object.keys(STD_PACKAGES)) {
    const config = JSON.parse(yield* fs.readFileString(path.join(std, dir, "deno.json")))
    const name: string = config.name.replace(/^@std\//, "")
    dirs.set(name, dir)
    const entries: Record<string, string> = typeof config.exports === "string"
      ? { ".": config.exports }
      : config.exports
    for (const [sub, file] of Object.entries(entries)) {
      const subpath = sub === "." ? name : `${name}/${sub.slice(2)}`
      specifiers.set(`@std/${subpath}`, [dir, file.slice(2)])
    }
  }
  return { specifiers, dirs } satisfies StdIndex
})

/** The packages to vendor: the requested ones plus every std package their code imports. */
const closure = Effect.fnUntraced(function*(std: string, index: StdIndex, wanted: ReadonlyArray<string>) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const result = new Set<string>()
  const queue = [...wanted]
  while (queue.length > 0) {
    const dir = queue.pop()!
    if (result.has(dir)) continue
    result.add(dir)
    for (const rel of yield* walk(path.join(std, dir))) {
      if (!rel.endsWith(".ts") || skip(rel, STD_PACKAGES[dir]!)) continue
      const src = yield* fs.readFileString(path.join(std, dir, rel))
      for (const match of src.matchAll(SPECIFIER)) {
        const target = index.specifiers.get(match[2]!)
        if (target && !result.has(target[0])) queue.push(target[0])
      }
    }
  }
  return [...result].sort()
})

const RELATIVE = /(["'])(\.\.?\/[^"']+)\1/g

// `rel` is the file's path inside its std package `dir`. Specifiers of other
// std packages, and relative imports that leave the package, point at the
// other package's `_std/`.
const rewrite = (src: string, dir: string, rel: string, out: string, index: StdIndex, path: Path.Path): string => {
  const dest = path.join(out, dir, "_std", rel)
  const toTarget = (pkg: string, file: string) => {
    let target = path.relative(path.dirname(dest), path.join(out, pkg, "_std", file))
    if (!target.startsWith(".")) target = `./${target}`
    return target
  }
  return src.split("\n").map((line) => {
    const trimmed = line.trimStart()
    if (trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("/*")) return line
    return line
      .replace(SPECIFIER, (m, q: string, spec: string) => {
        const target = index.specifiers.get(spec)
        return target ? `${q}${toTarget(target[0], target[1])}${q}` : m
      })
      .replace(RELATIVE, (m, q: string, spec: string) => {
        const resolved = path.normalize(path.join(dir, path.dirname(rel), spec))
        const [pkg, ...rest] = resolved.split("/")
        if (!pkg || pkg === dir || pkg === ".." || !(pkg in STD_PACKAGES)) return m
        return `${q}${toTarget(pkg, rest.join("/"))}${q}`
      })
  }).join("\n")
}

// workerd refuses to compile wasm from bytes at runtime, so the inline base64
// blob becomes a .wasm file imported as a WebAssembly.Module.
const externalizeWasm = Effect.fnUntraced(function*(out: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const lib = path.join(out, "crypto/_std/_wasm/lib")
  if (!(yield* fs.exists(lib))) return
  const loaderPath = path.join(lib, "deno_std_wasm_crypto.mjs")
  const loader = yield* fs.readFileString(loaderPath)
  const match = loader.match(/base64decode\("\\\n([\s\S]*?)"\);/)
  if (!match) return yield* new PortError({ message: "crypto: inline wasm not found" })
  const bytes = Uint8Array.from(atob(match[1]!.replaceAll("\\\n", "")), (c) => c.charCodeAt(0))
  yield* fs.writeFile(path.join(lib, "deno_std_wasm_crypto.wasm"), bytes)
  yield* fs.writeFileString(
    loaderPath,
    String.stripMargin(
      `|// @generated by scripts/cli.ts port from the wasmbuild output -- do not edit
       |// @ts-nocheck: generated
       |// deno-lint-ignore-file
       |// deno-fmt-ignore-file
       |// @ts-self-types="./deno_std_wasm_crypto.d.mts"
       |
       |import * as imports from "./deno_std_wasm_crypto.internal.mjs";
       |import wasmModule from "./deno_std_wasm_crypto.wasm";
       |const wasm = new WebAssembly.Instance(wasmModule, {
       |  "./deno_std_wasm_crypto.internal.mjs": imports,
       |});
       |
       |export * from "./deno_std_wasm_crypto.internal.mjs";
       |import { __wbg_set_wasm } from "./deno_std_wasm_crypto.internal.mjs";
       |__wbg_set_wasm(wasm.exports);
       |wasm.exports.__wbindgen_start();
       |`,
    ),
  )
})

/** Packages that currently keep vendored std code. */
export const vendoredPackages = Effect.fnUntraced(function*(root: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const kept: Array<string> = []
  for (const dir of Object.keys(STD_PACKAGES)) {
    if (yield* fs.exists(path.join(root, dir, "_std"))) kept.push(dir)
  }
  return kept
})

export interface PortOptions {
  readonly std: string
  readonly out: string
  readonly patches: boolean
  /** Packages to vendor; defaults to those with a `_std` directory in the output. */
  readonly packages?: ReadonlyArray<string> | undefined
}

export const port = Effect.fnUntraced(function*(options: PortOptions) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const { std, out } = options
  if (!(yield* fs.exists(path.join(std, "deno.json")))) {
    return yield* new PortError({ message: `No std checkout at ${std}` })
  }
  const index = yield* indexStd(std)
  const vendored = yield* vendoredPackages(out)
  // A first port, with nothing vendored yet, takes every std package.
  const wanted = options.packages ?? (vendored.length ? vendored : Object.keys(STD_PACKAGES))
  const packages = yield* closure(std, index, wanted)

  for (const dir of packages) {
    const from = path.join(std, dir)
    const to = path.join(out, dir, "_std")
    yield* fs.remove(to, { recursive: true, force: true })
    for (const rel of yield* walk(from)) {
      if (skip(rel, STD_PACKAGES[dir]!)) continue
      const dest = path.join(to, rel)
      yield* fs.makeDirectory(path.dirname(dest), { recursive: true })
      if (TEXT.test(rel)) {
        const src = yield* fs.readFileString(path.join(from, rel))
        yield* fs.writeFileString(dest, rewrite(src, dir, rel, out, index, path))
      } else {
        yield* fs.copyFile(path.join(from, rel), dest)
      }
    }
  }
  yield* externalizeWasm(out)

  const patchDir = path.join(ROOT, "patches")
  if (options.patches && (yield* fs.exists(patchDir))) {
    const files = (yield* fs.readDirectory(patchDir)).filter((f) => f.endsWith(".patch")).sort()
    for (const file of files) {
      yield* spawner.string(
        ChildProcess.make("git", ["apply", "--whitespace=nowarn", path.join(patchDir, file)], { cwd: out }),
      )
    }
  }
  const rev = (yield* spawner.string(ChildProcess.make("git", ["rev-parse", "--short", "HEAD"], { cwd: std }))).trim()
  yield* fs.writeFileString(path.join(out, "UPSTREAM"), `denoland/std@${rev}\n`)
  return { packages, rev }
})
