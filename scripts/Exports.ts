// Copyright 2026 the flareosaur authors. MIT license.
// Generates the `exports` map of the root deno.json from the public modules:
// `<dir>/mod.ts` is `./<dir>`, and every other `<dir>/<Name>.ts` that is not
// private (leading underscore) or a test is `./<dir>/<name>`.

import { Effect, FileSystem, Path, String } from "effect"
import { ALL_PACKAGES, kebab } from "./Packages.ts"
import { ROOT } from "./Port.ts"

export const isPublicModule = (file: string): boolean =>
  file.endsWith(".ts") && !file.startsWith("_") && !file.endsWith(".test.ts") && !file.endsWith(".d.ts")

/** Package directories that have a public API (a mod.ts). */
export const packageDirs = Effect.fnUntraced(function*() {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const dirs: Array<string> = []
  for (const dir of ALL_PACKAGES) {
    if (yield* fs.exists(path.join(ROOT, dir, "mod.ts"))) dirs.push(dir)
  }
  return dirs
})

export const publicModules = Effect.fnUntraced(function*(dir: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  return (yield* fs.readDirectory(path.join(ROOT, dir))).filter(isPublicModule).sort()
})

export const generateExports = Effect.fnUntraced(function*() {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const exports: Record<string, string> = {}
  for (const dir of yield* packageDirs()) {
    for (const file of yield* publicModules(dir)) {
      const name = file.slice(0, -3)
      const key = name === "mod" ? `./${kebab(dir)}` : `./${kebab(dir)}/${String.kebabCase(name)}`
      exports[key] = `./${dir}/${file}`
    }
  }
  const configPath = path.join(ROOT, "deno.json")
  const config = JSON.parse(yield* fs.readFileString(configPath))
  config.exports = exports
  yield* fs.writeFileString(configPath, JSON.stringify(config, null, 2) + "\n")
  return Object.keys(exports).length
})
