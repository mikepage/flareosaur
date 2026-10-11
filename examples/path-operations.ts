/**
 * @title Path operations
 * @difficulty beginner
 * @tags workers, path
 * @group Standard library
 * @resource {https://effect.website/docs/platform/path/} Effect: Path
 * @check GET / -> 200 "join: /assets/img/logo.png" "basename: logo.png" "extname: .png" "relative: ../css/site.css" "glob matches: true, false" "windows: C:\\Users\\ada\\notes.txt"
 *
 * Object keys in R2, routes and asset manifests are all paths, even on a
 * runtime without a filesystem. The path module has std's POSIX and Windows
 * implementations as pure functions and as layers for Effect's `Path`
 * service. On Workers there is no working directory, so relative paths
 * resolve against `/`.
 */

import { Console, Effect, Path } from "effect"
import * as Paths from "@mikepage/flareosaur/path"
import { script } from "./_lib/script.ts"

const program = Effect.gen(function*() {
  yield* Console.log(`join: ${Paths.join("/assets", "img", "../img/logo.png")}`)
  yield* Console.log(`basename: ${Paths.basename("/assets/img/logo.png")}`)
  yield* Console.log(`extname: ${Paths.extname("logo.png")}`)
  yield* Console.log(`relative: ${Paths.relative("/assets/js", "/assets/css/site.css")}`)

  const images = Paths.globToRegExp("assets/**/*.{png,jpg}")
  yield* Console.log(`glob matches: ${images.test("assets/img/a.png")}, ${images.test("assets/img/a.svg")}`)

  // Through Effect's Path service, here with the Windows layer.
  const windows = yield* Effect.service(Path.Path).pipe(Effect.provide(Paths.layerWindows))
  yield* Console.log(`windows: ${windows.join("C:\\Users", "ada", "notes.txt")}`)
})

export default script(program)
