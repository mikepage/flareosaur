// Copyright 2026 the flareosaur authors. MIT license.
// flareosaur.mikepage.nl: every example that runs without storage bindings,
// each mounted at /<slug>/, plus an index of all examples at /.
//
// A request to /<slug>/rest is passed to that example's Worker as /rest, with
// the example's demo vars added to its env. Requests are rate limited per IP
// with the Workers rate limiting binding.

import { Effect, Option } from "effect"
import { escape } from "@mikepage/flareosaur/html"
import * as Worker from "@mikepage/flareosaur/workers/worker"
import { examples, type SiteExample } from "./examples.generated.ts"

const SOURCE = "https://github.com/mikepage/flareosaur/blob/main/examples"

interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>
}

const bySlug = new Map(examples.map((e) => [e.slug, e]))

const indexHtml = (): string => {
  const groups = new Map<string, Array<SiteExample>>()
  for (const e of examples) groups.set(e.group, [...(groups.get(e.group) ?? []), e])
  const sections = [...groups].map(([group, list]) => {
    const items = list.map((e) => {
      const link = e.handler
        ? `<a href="/${e.slug}/">${escape(e.title)}</a>`
        : `${escape(e.title)} <small>(runs locally)</small>`
      return `<li>${link} · <a href="${SOURCE}/${e.slug}.ts">source</a><br><span>${escape(e.summary)}</span></li>`
    })
    return `<h2>${escape(group)}</h2><ul>${items.join("")}</ul>`
  })
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>flareosaur examples</title>
<style>
  :root { color-scheme: light dark; --brand: light-dark(#0066cc, #4da3ff); }
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 760px; margin: 2rem auto; padding: 0 16px; }
  a { color: var(--brand); }
  li { margin-bottom: .75rem; }
  span, small { color: GrayText; }
  code { font-family: ui-monospace, monospace; }
</style>
</head>
<body>
<h1>flareosaur examples</h1>
<p>Effect v4 on Cloudflare Workers, with no <code>nodejs_compat</code>. Each example is a Worker mounted at
<code>/&lt;example&gt;/</code>. The tools answer <code>GET /&lt;example&gt;/</code> with a description and
<code>GET /&lt;example&gt;/api</code> with JSON. Source and docs on
<a href="https://github.com/mikepage/flareosaur">GitHub</a> and <a href="https://jsr.io/@mikepage/flareosaur">JSR</a>.</p>
${sections.join("\n")}
</body>
</html>`
}

const indexJson = () =>
  examples.map((e) => ({
    slug: e.slug,
    title: e.title,
    group: e.group,
    summary: e.summary,
    url: e.handler ? `/${e.slug}/` : null,
    source: `${SOURCE}/${e.slug}.ts`,
  }))

export default Worker.make({
  fetch: (request) =>
    Effect.gen(function*() {
      const env = yield* Worker.Env
      const ctx = yield* Worker.ExecutionContext
      const url = new URL(request.url)
      const [, slug = "", ...rest] = url.pathname.split("/")

      if (slug === "") {
        return request.headers.get("accept")?.includes("application/json")
          ? Response.json(indexJson())
          : new Response(indexHtml(), { headers: { "content-type": "text/html; charset=utf-8" } })
      }

      const example = Option.fromNullishOr(bySlug.get(slug)).pipe(Option.filter((e) => e.handler !== undefined))
      if (Option.isNone(example)) return Response.json({ error: `No example at /${slug}` }, { status: 404 })
      // /dns-lookup -> /dns-lookup/, so relative links in the example resolve.
      if (rest.length === 0) return Response.redirect(`${url.origin}/${slug}/${url.search}`, 301)

      const limiter = env["RATE_LIMIT"] as RateLimit | undefined
      if (limiter) {
        const ip = request.headers.get("cf-connecting-ip") ?? "unknown"
        const { success } = yield* Effect.promise(() => limiter.limit({ key: ip }))
        if (!success) return Response.json({ error: "Too many requests" }, { status: 429 })
      }

      const inner = new URL(`/${rest.join("/")}${url.search}`, url.origin)
      const { handler, vars } = example.value
      return yield* Effect.promise(() => handler!.fetch!(new Request(inner, request), { ...env, ...vars }, ctx))
    }),
})
