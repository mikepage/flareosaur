// Copyright 2026 the flareosaur authors. MIT license.
// `check` type-checks the repo with tsc, then lints the public modules:
//
// - every public module is built on Effect: it imports `effect` (or an
//   `effect/*` module), unless it only re-exports other public modules
// - no Deno or Node APIs: no `Deno.` and no `node:` imports
// - other packages are used through their public modules, never their `_std`

import { Effect, FileSystem, Path, Schema } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { packageDirs, publicModules } from "./Exports.ts"
import { ROOT } from "./Port.ts"

export class CheckError extends Schema.TaggedError<CheckError>()("CheckError", {
  message: Schema.String,
}) {}

const IMPORT = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s*["']([^"']+)["']/g

export interface LintProblem {
  readonly file: string
  readonly problem: string
}

export const lint = Effect.fnUntraced(function*() {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const problems: Array<LintProblem> = []
  for (const dir of yield* packageDirs()) {
    for (const file of yield* publicModules(dir)) {
      const rel = `${dir}/${file}`
      const src = yield* fs.readFileString(path.join(ROOT, rel))
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
      const specifiers = [...code.matchAll(IMPORT)].map((m) => m[1]!)
      const usesEffect = specifiers.some((s) => s === "effect" || s.startsWith("effect/"))
      const onlyReexports = /^\s*(export\s+(\*|\{[^}]*\}|type\s*\{[^}]*\})(\s+as\s+\w+)?\s+from\s+["'][^"']+["'];?\s*)+$/
        .test(code.trim() + "\n") && specifiers.every((s) => s.startsWith("./") && !s.includes("_std"))
      if (!usesEffect && !onlyReexports) problems.push({ file: rel, problem: "does not import effect" })
      if (/\bDeno\./.test(code)) problems.push({ file: rel, problem: "uses the Deno namespace" })
      for (const s of specifiers) {
        if (s.startsWith("node:")) problems.push({ file: rel, problem: `imports ${s}` })
        if (/^\.\.\/[^/]+\/_std\//.test(s)) problems.push({ file: rel, problem: `imports another package's _std: ${s}` })
      }
    }
  }
  return problems
})

export const typecheck = Effect.fnUntraced(function*() {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const code = yield* spawner.exitCode(
    ChildProcess.make("npx", ["tsc", "-p", "tsconfig.json", "--pretty"], { cwd: ROOT, stdout: "inherit", stderr: "inherit" }),
  )
  return Number(code) === 0
})
