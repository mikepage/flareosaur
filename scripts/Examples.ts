// Copyright 2026 the flareosaur authors. MIT license.
// Runs the Workers examples in examples/*.ts and generates their index.
//
// Every example is a Worker module with a JSDoc header, in the style of
// docs.deno.com/examples:
//
//   @title       Hello world
//   @difficulty  beginner | intermediate | advanced
//   @tags        workers, http
//   @group       Basics
//   @resource    {https://...} Label
//   @bindings    kv:CACHE, d1:DB, r2:BUCKET, queue:JOBS, do:ROOMS=ChatRoom, var:NAME=value,
//                outbound:echo (outgoing fetches get a JSON echo of the request)
//   @check       GET /path [h:Name=Value | h:Name="quoted value"] [body] -> 200 "contains" !"absent" header:name~"value"
//   @check       scheduled [cron]
//   @check       queue JOBS {"json":"body"}
//   @check       ws /path send "message" -> "reply"
//   @check       none (needs a remote binding, e.g. Workers AI)
//
// `examples` bundles each one with esbuild, loads it into Miniflare with its
// bindings (no compatibility flags) and runs the checks in order.

import { build, type Plugin } from "esbuild"
import { Miniflare, type MiniflareOptions } from "miniflare"
import { Console, Effect, FileSystem, Path, Schema } from "effect"
import { ROOT } from "./Port.ts"

const DIR = `${ROOT}/examples`
const OUT = `${ROOT}/node_modules/.flareosaur-examples`
const COMPAT_DATE = "2026-07-30"

export class ExampleError extends Schema.TaggedError<ExampleError>()("ExampleError", {
  example: Schema.String,
  message: Schema.String,
}) {}

export interface Example {
  readonly slug: string
  readonly title: string
  readonly difficulty: string
  readonly tags: ReadonlyArray<string>
  readonly group: string
  readonly description: string
  readonly resources: ReadonlyArray<{ readonly url: string; readonly label: string }>
  readonly bindings: ReadonlyArray<string>
  readonly checks: ReadonlyArray<string>
}

/** Parses the JSDoc header of an example. */
export const parseHeader = (slug: string, source: string): Example => {
  const block = source.match(/\/\*\*([\s\S]*?)\*\//)?.[1] ?? ""
  const lines = block.split("\n").map((l) => l.replace(/^\s*\* ?/, ""))
  const tags = new Map<string, Array<string>>()
  const description: Array<string> = []
  for (const line of lines) {
    const tag = line.match(/^@(\w+)\s*(.*)$/)
    if (tag) {
      const list = tags.get(tag[1]!) ?? []
      list.push(tag[2]!.trim())
      tags.set(tag[1]!, list)
    } else if (!tags.size || description.length) {
      if (tags.size) description.push(line)
    } else {
      description.push(line)
    }
  }
  const one = (name: string) => tags.get(name)?.[0] ?? ""
  return {
    slug,
    title: one("title") || slug,
    difficulty: one("difficulty") || "beginner",
    tags: one("tags").split(",").map((t) => t.trim()).filter(Boolean),
    group: one("group") || "Other",
    description: description.join("\n").trim(),
    resources: (tags.get("resource") ?? []).map((r) => {
      const m = r.match(/^\{([^}]+)\}\s*(.*)$/)
      return { url: m?.[1] ?? r, label: m?.[2] ?? r }
    }),
    bindings: (tags.get("bindings") ?? []).flatMap((b) => b.split(",").map((s) => s.trim()).filter(Boolean)),
    checks: tags.get("check") ?? [],
  }
}

const bindingOptions = (example: Example): Partial<MiniflareOptions> => {
  const kv: Array<string> = []
  const d1: Array<string> = []
  const r2: Array<string> = []
  const queues: Record<string, string> = {}
  const durableObjects: Record<string, string> = {}
  const vars: Record<string, string> = {}
  let outbound = false
  for (const binding of example.bindings) {
    const [kind, rest = ""] = binding.split(/:(.*)/s)
    if (kind === "kv") kv.push(rest)
    else if (kind === "d1") d1.push(rest)
    else if (kind === "r2") r2.push(rest)
    else if (kind === "queue") queues[rest] = rest.toLowerCase()
    else if (kind === "do") {
      const [name, className] = rest.split("=")
      durableObjects[name!] = className!
    } else if (kind === "outbound") {
      outbound = true
    } else if (kind === "var") {
      const [name, ...value] = rest.split("=")
      vars[name!] = value.join("=")
    }
  }
  return {
    kvNamespaces: kv,
    d1Databases: d1,
    r2Buckets: r2,
    queueProducers: queues,
    queueConsumers: Object.fromEntries(Object.values(queues).map((q) => [q, { maxBatchTimeout: 0 }])),
    durableObjects,
    bindings: vars,
    // outbound:echo answers every outgoing fetch with a description of the
    // request as JSON, standing in for an upstream API.
    ...(outbound
      ? {
        outboundService: async (request: Request) => {
          const url = new URL(request.url)
          const body = request.body ? await request.text() : null
          if (url.pathname.startsWith("/status/")) return new Response(null, { status: Number(url.pathname.slice(8)) })
          if (url.pathname.startsWith("/slow")) await new Promise((r) => setTimeout(r, 2000))
          return Response.json({
            method: request.method,
            url: request.url,
            headers: Object.fromEntries(request.headers),
            body,
          })
        },
      }
      : {}),
  }
}

interface HttpCheck {
  readonly method: string
  readonly path: string
  readonly headers: Record<string, string>
  readonly body: string | undefined
  readonly status: number
  readonly contains: ReadonlyArray<string>
  readonly absent: ReadonlyArray<string>
  readonly headerContains: ReadonlyArray<readonly [string, string]>
}

const QUOTED = /"((?:[^"\\]|\\.)*)"/g
const unquote = (s: string) => JSON.parse(`"${s}"`) as string

const parseHttpCheck = (check: string): HttpCheck => {
  const [request, expectation = ""] = check.split(/\s->\s/)
  // Tokens are separated by spaces; a header value may be quoted:
  // h:authorization="Basic dXNlcjpwYXNz"
  const tokens = request!.trim().match(/h:[^=\s]+="(?:[^"\\]|\\.)*"|\S+/g) ?? []
  const [method, path, ...rest] = tokens
  const headers: Record<string, string> = {}
  const bodyParts: Array<string> = []
  for (const part of rest) {
    const h = part.match(/^h:([^=]+)=(.*)$/)
    if (h && !bodyParts.length) headers[h[1]!] = h[2]!.startsWith('"') ? unquote(h[2]!.slice(1, -1)) : h[2]!
    else bodyParts.push(part)
  }
  const status = Number(expectation.trim().match(/^(\d{3})/)?.[1] ?? 200)
  const contains: Array<string> = []
  const absent: Array<string> = []
  const headerContains: Array<readonly [string, string]> = []
  for (const m of expectation.matchAll(/(!|header:([\w-]+)~)?"((?:[^"\\]|\\.)*)"/g)) {
    if (m[1] === "!") absent.push(unquote(m[3]!))
    else if (m[2]) headerContains.push([m[2], unquote(m[3]!)])
    else contains.push(unquote(m[3]!))
  }
  void QUOTED
  return {
    method: method!,
    path: path!,
    headers,
    // A quoted body may use JSON escapes such as \n.
    body: bodyParts.length
      ? (() => {
        const raw = bodyParts.join(" ")
        return raw.startsWith('"') && raw.endsWith('"') ? unquote(raw.slice(1, -1)) : raw
      })()
      : undefined,
    status,
    contains,
    absent,
    headerContains,
  }
}

const runCheck = (mf: Miniflare, example: Example, check: string) =>
  Effect.tryPromise({
    try: async () => {
      if (check === "none") return
      if (check.startsWith("scheduled")) {
        const worker = await mf.getWorker()
        const cron = check.slice("scheduled".length).trim() || "* * * * *"
        const result = await worker.scheduled({ cron })
        if (result.outcome !== "ok") throw new Error(`scheduled outcome ${result.outcome}`)
        return
      }
      if (check.startsWith("queue ")) {
        const [, queue, ...body] = check.split(/\s+/)
        const worker = await mf.getWorker()
        const result = await worker.queue(queue!.toLowerCase(), [{
          id: crypto.randomUUID(),
          timestamp: new Date(),
          body: JSON.parse(body.join(" ")),
          attempts: 1,
        }])
        if (result.outcome !== "ok") throw new Error(`queue outcome ${result.outcome}`)
        return
      }
      if (check.startsWith("ws ")) {
        const [request, expected = ""] = check.split(/\s->\s/)
        const path = request!.split(/\s+/)[1]!
        const sends = [...request!.matchAll(QUOTED)].map((m) => unquote(m[1]!))
        const replies = [...expected.matchAll(QUOTED)].map((m) => unquote(m[1]!))
        const res = await mf.dispatchFetch(`http://localhost${path}`, { headers: { Upgrade: "websocket" } })
        const ws = res.webSocket
        if (!ws) throw new Error(`no WebSocket upgrade (status ${res.status})`)
        ws.accept()
        const received: Array<string> = []
        const done = new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`timed out; received ${JSON.stringify(received)}`)), 5000)
          ws.addEventListener("message", (event) => {
            received.push(String(event.data))
            if (replies.every((r) => received.some((m) => m.includes(r)))) {
              clearTimeout(timer)
              resolve()
            }
          })
        })
        for (const message of sends) ws.send(message)
        await done
        ws.close()
        return
      }
      const c = parseHttpCheck(check)
      const res = await mf.dispatchFetch(`http://localhost${c.path}`, {
        method: c.method,
        headers: c.headers,
        ...(c.body === undefined ? {} : { body: c.body }),
        redirect: "manual",
      })
      const text = await res.text()
      const problems: Array<string> = []
      if (res.status !== c.status) problems.push(`status ${res.status}, expected ${c.status}`)
      for (const s of c.contains) if (!text.includes(s)) problems.push(`body lacks ${JSON.stringify(s)}`)
      for (const s of c.absent) if (text.includes(s)) problems.push(`body contains ${JSON.stringify(s)}`)
      for (const [name, s] of c.headerContains) {
        if (!(res.headers.get(name) ?? "").includes(s)) problems.push(`header ${name}=${JSON.stringify(res.headers.get(name))} lacks ${JSON.stringify(s)}`)
      }
      if (problems.length) throw new Error(`${problems.join("; ")}\n--- body ---\n${text.slice(0, 1500)}`)
    },
    catch: (e) => new ExampleError({ example: example.slug, message: `${check}: ${e instanceof Error ? e.message : String(e)}` }),
  })

/** Lists the examples, sorted by group and title. */
export const loadExamples = Effect.fnUntraced(function*() {
  const fs = yield* FileSystem.FileSystem
  const files = (yield* fs.readDirectory(DIR)).filter((f) => f.endsWith(".ts") && !f.startsWith("_") && !f.endsWith(".d.ts"))
  const examples: Array<Example> = []
  for (const file of files) examples.push(parseHeader(file.slice(0, -3), yield* fs.readFileString(`${DIR}/${file}`)))
  return examples.sort((a, b) => a.group.localeCompare(b.group) || a.title.localeCompare(b.title))
})

// Resolves the published specifiers (@mikepage/flareosaur/...) to this repo.
const selfResolver = (name: string, exports: Record<string, string>): Plugin => ({
  name: "self",
  setup(b) {
    b.onResolve({ filter: new RegExp(`^${name.replace("/", "\\/")}(/|$)`) }, (args) => {
      const key = `.${args.path.slice(name.length)}`
      const file = exports[key]
      return file ? { path: `${ROOT}/${file.slice(2)}` } : { errors: [{ text: `No export ${args.path}` }] }
    })
  },
})

const runExample = Effect.fnUntraced(function*(example: Example) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const config = JSON.parse(yield* fs.readFileString(`${ROOT}/deno.json`))
  const out = path.join(OUT, example.slug)
  yield* fs.remove(out, { recursive: true, force: true })
  yield* Effect.tryPromise({
    try: () =>
      build({
        entryPoints: [path.join(DIR, `${example.slug}.ts`)],
        outdir: out,
        bundle: true,
        format: "esm",
        platform: "neutral",
        target: "esnext",
        conditions: ["workerd", "worker", "browser"],
        mainFields: ["module", "main"],
        loader: { ".wasm": "copy" },
        external: ["cloudflare:*"],
        plugins: [selfResolver(config.name, config.exports)],
        logLevel: "silent",
      }),
    catch: (e) => new ExampleError({ example: example.slug, message: `bundle: ${e instanceof Error ? e.message : String(e)}` }),
  })
  const modules = []
  for (const name of yield* fs.readDirectory(out)) {
    modules.push({
      type: name.endsWith(".wasm") ? "CompiledWasm" as const : "ESModule" as const,
      path: path.join(out, name),
      contents: yield* fs.readFile(path.join(out, name)),
    })
  }
  modules.sort((a, b) => a.path.endsWith(`${example.slug}.js`) ? -1 : b.path.endsWith(`${example.slug}.js`) ? 1 : 0)
  yield* Effect.scoped(Effect.gen(function*() {
    const mf = yield* Effect.acquireRelease(
      Effect.sync(() =>
        new Miniflare({
          modules,
          modulesRoot: out,
          compatibilityDate: COMPAT_DATE,
          compatibilityFlags: [],
          ...bindingOptions(example),
        } as MiniflareOptions)
      ),
      (mf) => Effect.promise(() => mf.dispose().catch(() => {})),
    )
    for (const check of example.checks) yield* runCheck(mf, example, check)
  }))
})

export const runExamples = Effect.fnUntraced(function*(slugs: ReadonlyArray<string>) {
  const examples = (yield* loadExamples()).filter((e) => !slugs.length || slugs.includes(e.slug))
  let failed = 0
  for (const example of examples) {
    const result = yield* Effect.result(runExample(example))
    if (result._tag === "Failure") {
      failed++
      yield* Console.log(`FAIL ${example.slug}\n     ${result.failure.message.split("\n").join("\n     ")}`)
    } else {
      const manual = example.checks.length === 0 || example.checks.every((c) => c === "none")
      yield* Console.log(`${manual ? "skip" : "ok  "} ${example.slug}${manual ? " (no local checks)" : ""}`)
    }
  }
  yield* Console.log(`\n${examples.length - failed} of ${examples.length} examples passed`)
  return failed
})

/** Generates examples/README.md: every example, by group. */
export const generateIndex = Effect.fnUntraced(function*() {
  const fs = yield* FileSystem.FileSystem
  const examples = yield* loadExamples()
  const groups = new Map<string, Array<Example>>()
  for (const e of examples) groups.set(e.group, [...(groups.get(e.group) ?? []), e])
  const lines = [
    "# flareosaur examples",
    "",
    "Effect v4 versions of the [Deno examples](https://docs.deno.com/examples/), as Cloudflare Workers.",
    "Each file is a Worker with a commented walkthrough. They run in workerd with no `nodejs_compat`,",
    "and `npm run examples` checks every one of them in Miniflare.",
    "",
    "Run one locally with `npx wrangler dev examples/<name>.ts` (add the bindings listed in its header).",
    "",
    `${examples.length} examples in ${groups.size} groups.`,
    "",
  ]
  for (const [group, list] of groups) {
    lines.push(`## ${group}`, "", "| Example | What it shows |", "| --- | --- |")
    for (const e of list) {
      const summary = e.description.split("\n\n")[0]!.replace(/\s+/g, " ").replaceAll("|", "\\|")
      lines.push(`| [${e.title}](${e.slug}.ts) | ${summary} |`)
    }
    lines.push("")
  }
  yield* fs.writeFileString(`${DIR}/README.md`, lines.join("\n"))
  return examples.length
})
