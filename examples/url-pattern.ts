/**
 * @title Parse URLs and match routes with URLPattern
 * @difficulty beginner
 * @tags workers, web
 * @group Standard library
 * @resource {https://developer.mozilla.org/en-US/docs/Web/API/URLPattern} MDN: URLPattern
 * @resource {https://effect.website/docs/schema/introduction/} Effect: Schema
 * @check GET / -> 200 "host: example.com" "q=effect" "user 42 / post hello-world" "no match: Option.none" "decoded: {\"id\":42,\"slug\":\"hello-world\"}"
 *
 * `URL` parses and edits URLs, and `URLPattern` (built into Workers) matches
 * them against route patterns. Pattern groups are strings; decode them with
 * a Schema to get typed values, and use `Option` for a match that may not
 * happen.
 */

import { Console, Effect, Option, Schema } from "effect"
import { script } from "./_lib/script.ts"

const pattern = new URLPattern({ pathname: "/users/:id/posts/:slug" })
const PostParams = Schema.Struct({ id: Schema.FiniteFromString, slug: Schema.String })

const match = (url: string) => Option.fromNullishOr(pattern.exec(url))

const program = Effect.gen(function*() {
  const url = new URL("https://example.com/search?q=effect&page=2#top")
  yield* Console.log(`host: ${url.host}, path: ${url.pathname}`)
  url.searchParams.delete("page")
  yield* Console.log(`query now: ${url.searchParams}`)

  const hit = match("https://example.com/users/42/posts/hello-world")
  yield* Option.match(hit, {
    onNone: () => Console.log("no match"),
    onSome: (m) => Console.log(`user ${m.pathname.groups.id} / post ${m.pathname.groups.slug}`),
  })
  yield* Console.log(`no match: ${Option.isNone(match("https://example.com/about")) ? "Option.none" : "?"}`)

  // Decode the groups into typed values.
  const params = yield* Schema.decodeUnknownEffect(PostParams)(Option.getOrThrow(hit).pathname.groups)
  yield* Console.log(`decoded: ${JSON.stringify(params)}`)
})

export default script(program)
