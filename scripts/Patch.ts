// Copyright 2026 the flareosaur authors. MIT license.
// Regenerates patches/edge.patch: the difference between a fresh, unpatched
// port of the std checkout and the vendored `_std` directories in this repo.

import { Effect, FileSystem, Path } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { port, ROOT, vendoredPackages } from "./Port.ts"

export const makePatch = Effect.fnUntraced(function*(std: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const tmp = yield* fs.makeTempDirectoryScoped({ prefix: "flareosaur-patch-" })
  const git = (...args: ReadonlyArray<string>) =>
    spawner.string(ChildProcess.make("git", ["-c", "core.autocrlf=false", ...args], { cwd: tmp }))

  const { packages } = yield* port({ std, out: tmp, patches: false, packages: yield* vendoredPackages(ROOT) })
  yield* git("init", "-q")
  yield* git("add", "-A")
  yield* git("-c", "user.name=port", "-c", "user.email=port@localhost", "commit", "-qm", "port")

  for (const dir of packages) {
    const from = path.join(ROOT, dir, "_std")
    const to = path.join(tmp, dir, "_std")
    yield* fs.remove(to, { recursive: true, force: true })
    if (yield* fs.exists(from)) yield* fs.copy(from, to)
  }
  yield* git("add", "-A")
  const patch = yield* git("diff", "--cached", "--binary")
  yield* fs.makeDirectory(path.join(ROOT, "patches"), { recursive: true })
  yield* fs.writeFileString(path.join(ROOT, "patches/edge.patch"), patch)
  return (yield* git("diff", "--cached", "--shortstat")).trim()
}, Effect.scoped)
