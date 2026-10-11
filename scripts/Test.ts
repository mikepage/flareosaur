// Copyright 2026 the flareosaur authors. MIT license.
// Runs each package's tests inside workerd with no compatibility flags.
//
// Per package: bundle its Effect tests (`*.test.ts`) and std's tests in
// `_std/` (`*_test.ts`), plus every public module, imported statically so
// global-scope violations surface, with esbuild. Load the bundle into
// Miniflare and call fetch() once per test file. Std tests listed in
// scripts/skip.json need a real filesystem, subprocesses or Node, and are
// reported as skipped.

import { build, type Plugin } from "esbuild"
import { readFileSync } from "node:fs"
import { Miniflare } from "miniflare"
import { Console, Effect, FileSystem, Path, Schema } from "effect"
import { ALL_PACKAGES, kebab } from "./Packages.ts"
import { ROOT, walk } from "./Port.ts"

const OUT = `${ROOT}/node_modules/.flareosaur-test`
const COMPAT_DATE = "2026-07-30"
const RUNTIME = `${ROOT}/scripts/workerd/runtime.js`

export class TestRunError extends Schema.TaggedError<TestRunError>()("TestRunError", {
  message: Schema.String,
}) {}

interface Result {
  readonly file: string
  readonly name: string
  status: "pass" | "fail" | "ignored" | "skipped"
  readonly error?: string
}

const SkipGroups = Schema.Array(Schema.Struct({
  reason: Schema.String,
  tests: Schema.Record(Schema.String, Schema.Union([Schema.Literal("*"), Schema.Array(Schema.String)])),
}))

const loadSkips = Effect.fnUntraced(function*() {
  const fs = yield* FileSystem.FileSystem
  const groups = yield* Schema.decodeUnknownEffect(SkipGroups)(
    JSON.parse(yield* fs.readFileString(`${ROOT}/scripts/skip.json`)),
  )
  const skips = new Map<string, "*" | Array<string>>()
  for (const { tests } of groups) {
    for (const [file, names] of Object.entries(tests)) {
      const prev = skips.get(file)
      skips.set(file, names === "*" || prev === "*" ? "*" : [...(prev ?? []), ...names])
    }
  }
  return skips
})

const isTestFile = (rel: string): boolean =>
  rel.startsWith("_std/")
    ? /(^|[_/])test\.ts$/.test(rel) && !rel.includes("/testdata/")
    : rel.endsWith(".test.ts")

// A few std tests import node: built-ins to compare against Node. workerd has
// none without nodejs_compat, so they resolve to stubs that throw when used.
const nodeStubs: Plugin = {
  name: "node-stubs",
  setup(b) {
    b.onResolve({ filter: /^node:/ }, (a) => ({ path: a.path, namespace: "node-stub" }))
    b.onLoad({ filter: /.*/, namespace: "node-stub" }, (a) => ({
      contents: `const stub = new Proxy(function () {}, {
  get(_, key) {
    if (key === "__esModule" || key === Symbol.toPrimitive) return undefined;
    throw new Error("${a.path} is not available in workerd: " + String(key));
  },
  apply() { throw new Error("${a.path} is not available in workerd"); },
});
export default stub;
export const { inspect, isMainThread, Worker, cwd, platform } = new Proxy({}, { get: () => stub });`,
      loader: "js",
    }))
  },
}

// Bundling erases import.meta.url, so std test files get their own file URL
// back, which is what their testdata paths are built from.
const importMeta = (readFile: (path: string) => string): Plugin => ({
  name: "import-meta",
  setup(b) {
    b.onLoad({ filter: /(_test|[\\/]test)\.ts$/ }, (a) => {
      const url = JSON.stringify(new URL(`file://${a.path}`).href)
      const contents = readFile(a.path)
        .replaceAll("import.meta.url", url)
        .replaceAll("import.meta.resolve(", `((s) => new URL(s, ${url}).href)(`)
      return { contents, loader: "ts" }
    })
  },
})

const bundle = Effect.fnUntraced(function*(pkg: string, files: ReadonlyArray<string>, publicModules: ReadonlyArray<string>) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const dir = path.join(ROOT, pkg)
  const out = path.join(OUT, pkg)
  yield* fs.remove(out, { recursive: true, force: true })
  yield* fs.makeDirectory(out, { recursive: true })
  const rel = (f: string) => JSON.stringify(path.relative(out, f))
  const entry = [
    `import { run, setFixtures } from ${rel(RUNTIME)};`,
    `import fixtures from "./fixtures.json";`,
    `setFixtures(fixtures);`,
    ...publicModules.map((m, i) => `import * as _public${i} from ${rel(path.join(ROOT, m))};`),
    `const files = {`,
    ...files.map((f) => `  ${JSON.stringify(f)}: () => import(${rel(path.join(dir, f))}),`),
    `};`,
    `export default {`,
    `  async fetch(request) {`,
    `    const url = new URL(request.url);`,
    `    const file = url.searchParams.get("file");`,
    `    if (!file) return Response.json(Object.keys(files));`,
    `    return Response.json(await run({ [file]: files[file] }, url.searchParams.has("trace")));`,
    `  },`,
    `};`,
  ].join("\n")

  const fixtures: Record<string, string> = {}
  const testdata = path.join(dir, "_std/testdata")
  if (yield* fs.exists(testdata)) {
    for (const f of yield* walk(testdata)) {
      const abs = path.join(testdata, f)
      const bytes = yield* fs.readFile(abs)
      fixtures[abs] = btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""))
    }
  }
  yield* fs.writeFileString(path.join(out, "fixtures.json"), JSON.stringify(fixtures))
  const entryPath = path.join(out, "entry.js")
  yield* fs.writeFileString(entryPath, entry)

  const sources = new Map<string, string>()
  for (const f of files) sources.set(path.join(dir, f), yield* fs.readFileString(path.join(dir, f)))
  yield* Effect.tryPromise({
    try: () =>
      build({
        entryPoints: [entryPath],
        outdir: path.join(out, "dist"),
        bundle: true,
        splitting: true,
        format: "esm",
        platform: "neutral",
        target: "esnext",
        conditions: ["workerd", "worker", "browser"],
        mainFields: ["module", "main"],
        loader: { ".wasm": "copy" },
        define: {
          "Deno.test": "__denoTest",
          "Deno.readFile": "__denoReadFile",
          "Deno.readFileSync": "__denoReadFileSync",
          "Deno.readTextFile": "__denoReadTextFile",
          "Deno.readTextFileSync": "__denoReadTextFileSync",
        },
        inject: [RUNTIME],
        plugins: [nodeStubs, importMeta((p) => sources.get(p) ?? readFileSync(p, "utf8"))],
        keepNames: true,
        logLevel: "silent",
      }),
    catch: (e) => new TestRunError({ message: e instanceof Error ? e.message : String(e) }),
  })

  const dist = path.join(out, "dist")
  const modules = []
  for (const name of (yield* fs.readDirectory(dist)).sort((a, b) => a === "entry.js" ? -1 : b === "entry.js" ? 1 : 0)) {
    modules.push({
      type: name.endsWith(".wasm") ? "CompiledWasm" as const : "ESModule" as const,
      path: path.join(dist, name),
      contents: yield* fs.readFile(path.join(dist, name)),
    })
  }
  return { modules, modulesRoot: dist }
})

const worker = (options: { modules: Array<{ type: "ESModule" | "CompiledWasm"; path: string; contents: Uint8Array }>; modulesRoot: string }) =>
  Effect.acquireRelease(
    Effect.sync(() =>
      new Miniflare({
        modules: options.modules,
        modulesRoot: options.modulesRoot,
        compatibilityDate: COMPAT_DATE,
        compatibilityFlags: [],
      })
    ),
    (mf) => Effect.promise(() => mf.dispose().catch(() => {})),
  )

const fetchJson = (mf: Miniflare, url: string) =>
  Effect.tryPromise({
    try: async () => {
      const res = await mf.dispatchFetch(url)
      const text = await res.text()
      if (!res.ok) throw new Error(text.slice(0, 2000))
      return JSON.parse(text) as unknown
    },
    catch: (e) => new TestRunError({ message: e instanceof Error ? e.message : String(e) }),
  })

const runPackage = Effect.fnUntraced(function*(pkg: string, filter: (file: string) => boolean, publicModules: ReadonlyArray<string>, trace: boolean) {
  const path = yield* Path.Path
  const files = (yield* walk(path.join(ROOT, pkg))).filter((f) => isTestFile(f) && filter(f))
  const built = yield* bundle(pkg, files, publicModules).pipe(Effect.result)
  if (built._tag === "Failure") {
    return [{ file: "<bundle>", name: "<bundle>", status: "fail", error: built.failure.message }] as Array<Result>
  }
  const results: Array<Result> = []
  // One worker per file, so a crashed isolate takes down only its own file.
  for (const file of files) {
    const exit = yield* Effect.scoped(Effect.gen(function*() {
      const mf = yield* worker(built.success)
      return yield* fetchJson(mf, `http://localhost/?file=${encodeURIComponent(file)}${trace ? "&trace" : ""}`)
    })).pipe(Effect.result)
    if (exit._tag === "Failure") results.push({ file, name: "<worker>", status: "fail", error: exit.failure.message })
    else results.push(...(exit.success as Array<Result>))
  }
  return results
})

export interface TestOptions {
  /** "pkg" runs a package, "pkg/path/to/file.test.ts" a single file of it. */
  readonly targets: ReadonlyArray<string>
  readonly verbose: boolean
  readonly trace: boolean
}

export const runTests = Effect.fnUntraced(function*(options: TestOptions) {
  const fs = yield* FileSystem.FileSystem
  const config = JSON.parse(yield* fs.readFileString(`${ROOT}/deno.json`))
  const exportTargets = Object.values(config.exports as Record<string, string>)
  const packages: Array<string> = []
  for (const dir of ALL_PACKAGES) {
    if (yield* fs.exists(`${ROOT}/${dir}`)) packages.push(dir)
  }
  const { targets } = options
  const selected = targets.length ? [...new Set(targets.map((t) => t.split("/")[0]!))] : packages
  const skips = yield* loadSkips()
  const usedSkips = new Set<string>()
  const totals = { pass: 0, fail: 0, ignored: 0, skipped: 0 }
  const failures: Array<Result & { pkg: string }> = []

  for (const pkg of selected) {
    const filter = (file: string) =>
      !targets.some((t) => t.startsWith(`${pkg}/`)) || targets.includes(`${pkg}/${file}`)
    const publicModules = exportTargets.filter((t) => t.startsWith(`./${pkg}/`))
    const results = yield* runPackage(pkg, filter, publicModules, options.trace)
    const count = { pass: 0, fail: 0, ignored: 0, skipped: 0 }
    for (const r of results) {
      const list = skips.get(`${pkg}/${r.file}`)
      if (r.status === "fail" && (list === "*" || list?.includes(r.name))) {
        r.status = "skipped"
        usedSkips.add(`${pkg}/${r.file}`)
        usedSkips.add(`${pkg}/${r.file} :: ${r.name}`)
      }
      count[r.status]++
      totals[r.status]++
      if (r.status === "fail") failures.push({ pkg, ...r })
    }
    yield* Console.log(
      `${count.fail ? "FAIL" : "ok  "} ${kebab(pkg).padEnd(16)} ${count.pass} passed, ${count.fail} failed, ${count.skipped} skipped, ${count.ignored} ignored`,
    )
  }

  const stale = [...skips].flatMap(([file, names]) => {
    if (!selected.includes(file.split("/")[0]!)) return []
    if (names === "*") return usedSkips.has(file) ? [] : [file]
    return names.filter((n) => !usedSkips.has(`${file} :: ${n}`)).map((n) => `${file} :: ${n}`)
  })
  if (stale.length && !targets.some((t) => t.includes("/"))) {
    yield* Console.log("\nStale entries in scripts/skip.json (these tests pass now):")
    for (const s of stale) yield* Console.log(`  ${s}`)
  }
  if (failures.length) {
    yield* Console.log("\nFailures:")
    for (const f of failures) {
      const err = options.verbose ? f.error : f.error?.split("\n")[0]?.slice(0, 200)
      yield* Console.log(`  ${f.pkg}/${f.file} :: ${f.name}\n    ${err}`)
    }
  }
  yield* Console.log(`\n${totals.pass} passed, ${totals.fail} failed, ${totals.skipped} skipped, ${totals.ignored} ignored`)
  return totals
})
