// Copyright 2026 the flareosaur authors. MIT license.
// End to end: an HttpRouter app converted with HttpRouter.toWebHandler and
// driven with web Requests inside workerd. Also covers Route.
import { Effect, Layer, Option, Redacted, Stream } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"
import { describe, it } from "../testing/mod.ts"
import { assertEquals, assertMatch } from "../assert/mod.ts"
import * as CacheControl from "./CacheControl.ts"
import * as ETag from "./Etag.ts"
import * as Negotiation from "./Negotiation.ts"
import * as ProblemDetails from "./ProblemDetails.ts"
import * as Route from "./Route.ts"
import * as ServerSentEvents from "./ServerSentEvents.ts"
import * as SignedCookie from "./SignedCookie.ts"

const App = Layer.mergeAll(
  HttpRouter.add(
    "GET",
    "/hello",
    Effect.gen(function*() {
      const type = yield* Negotiation.negotiate(["text/plain", "application/json"])
      if (Option.isNone(type)) return yield* ProblemDetails.problem(406, "Use text/plain or application/json")
      const language = yield* Negotiation.negotiateLanguage(["en", "nl"])
      const greeting = Option.getOrElse(language, () => "en") === "nl" ? "hallo" : "hello"
      return type.value === "text/plain"
        ? HttpServerResponse.text(greeting)
        : HttpServerResponse.jsonUnsafe({ greeting })
    }),
  ),
  HttpRouter.add("POST", "/login", HttpServerResponse.text("ok").pipe(SignedCookie.setCookie("session", "user-1", { path: "/" }))),
  HttpRouter.add(
    "GET",
    "/me",
    Effect.gen(function*() {
      const user = yield* SignedCookie.getCookie("session")
      if (Option.isNone(user)) return yield* new ProblemDetails.Problem({ status: 401, title: "Not signed in" })
      return HttpServerResponse.text(user.value)
    }),
  ),
  HttpRouter.add(
    "GET",
    "/items/:id",
    Effect.gen(function*() {
      const { id } = yield* HttpRouter.params
      return yield* ProblemDetails.problem(404, `No item ${id}`, { id })
    }),
  ),
  HttpRouter.add(
    "GET",
    "/boom",
    Effect.fail(new Error("internal detail")).pipe(ProblemDetails.catchProblems()),
  ),
  HttpRouter.add(
    "GET",
    "/events",
    ServerSentEvents.response(
      Stream.make(
        ServerSentEvents.retry("1 second"),
        ServerSentEvents.event({ data: "one", id: "1" }),
        ServerSentEvents.event({ event: "done", data: "two", id: "2" }),
      ),
    ),
  ),
  HttpRouter.add(
    "GET",
    "/doc",
    Effect.gen(function*() {
      const body = "a cacheable document"
      const response = yield* HttpServerResponse.text(body).pipe(CacheControl.set({ public: true, noCache: true }))
      return yield* ETag.respond(response, yield* ETag.fromEntity(body))
    }),
  ),
  HttpRouter.add(
    "*",
    "/files/*",
    Route.route(
      [
        Route.make("/files/:name.:ext(txt|md)", (match) =>
          Effect.succeed(HttpServerResponse.text(`${match.pathname.groups.name} (${match.pathname.groups.ext})`)), "GET"),
        Route.make({ pathname: "/files/*", search: "raw" }, () => Effect.succeed(HttpServerResponse.text("raw"))),
      ],
      Effect.succeed(HttpServerResponse.empty({ status: 404 })),
    ),
  ),
  SignedCookie.layer(Redacted.make("a test secret")),
)

const withApp = <A, E>(f: (fetch: (path: string, init?: RequestInit) => Promise<Response>) => Effect.Effect<A, E>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => HttpRouter.toWebHandler(App, { disableLogger: true })),
    ({ handler }) => f((path, init) => handler(new Request(`https://app.test${path}`, init))),
    ({ dispose }) => Effect.promise(dispose),
  )

const call = (fetch: (path: string, init?: RequestInit) => Promise<Response>, path: string, init?: RequestInit) =>
  Effect.promise(async () => {
    const response = await fetch(path, init)
    return { response, body: await response.text() }
  })

describe("HttpRouter.toWebHandler", () => {
  it.live("negotiates content type and language", () =>
    withApp((fetch) =>
      Effect.gen(function*() {
        const text = yield* call(fetch, "/hello", { headers: { accept: "text/*", "accept-language": "nl, en;q=0.5" } })
        assertEquals(text.body, "hallo")
        const json = yield* call(fetch, "/hello", { headers: { accept: "application/json" } })
        assertEquals(JSON.parse(json.body), { greeting: "hello" })
        const none = yield* call(fetch, "/hello", { headers: { accept: "image/png" } })
        assertEquals(none.response.status, 406)
        assertEquals(none.response.headers.get("content-type"), "application/problem+json")
        assertEquals(JSON.parse(none.body).title, "Not Acceptable")
      })
    ))

  it.live("sets and verifies signed cookies", () =>
    withApp((fetch) =>
      Effect.gen(function*() {
        const login = yield* call(fetch, "/login", { method: "POST" })
        const cookie = login.response.headers.get("set-cookie")!
        assertMatch(cookie, /^session=user-1\.[0-9a-f]{64}; Path=\//)
        const pair = cookie.split(";")[0]!
        const me = yield* call(fetch, "/me", { headers: { cookie: pair } })
        assertEquals(me.body, "user-1")
        const forged = yield* call(fetch, "/me", { headers: { cookie: pair.replace("user-1", "admin") } })
        assertEquals(forged.response.status, 401)
        assertEquals(JSON.parse(forged.body), { status: 401, title: "Not signed in", type: "about:blank" })
      })
    ))

  it.live("answers typed failures with problem details", () =>
    withApp((fetch) =>
      Effect.gen(function*() {
        const missing = yield* call(fetch, "/items/42")
        assertEquals(missing.response.status, 404)
        assertEquals(JSON.parse(missing.body), {
          id: "42",
          status: 404,
          detail: "No item 42",
          type: "about:blank",
          title: "Not Found",
        })
        const boom = yield* call(fetch, "/boom")
        assertEquals(boom.response.status, 500)
        assertEquals(JSON.parse(boom.body), { status: 500, type: "about:blank", title: "Internal Server Error" })
      })
    ))

  it.live("streams server-sent events", () =>
    withApp((fetch) =>
      Effect.gen(function*() {
        const response = yield* Effect.promise(() => fetch("/events"))
        assertEquals(response.headers.get("content-type"), "text/event-stream")
        const events = yield* Stream.runCollect(ServerSentEvents.decodeReadable(response.body!))
        assertEquals(events.map((e) => e._tag === "Event" ? `${e.event}:${e.id}:${e.data}` : e._tag), [
          "Retry",
          "message:1:one",
          "done:2:two",
        ])
      })
    ))

  it.live("serves conditional requests with ETags and Cache-Control", () =>
    withApp((fetch) =>
      Effect.gen(function*() {
        const first = yield* call(fetch, "/doc")
        assertEquals(first.response.status, 200)
        assertEquals(first.response.headers.get("cache-control"), "no-cache, public")
        const etag = first.response.headers.get("etag")!
        assertMatch(etag, /^"[0-9a-f]+-.+"$/)
        const second = yield* call(fetch, "/doc", { headers: { "if-none-match": etag } })
        assertEquals(second.response.status, 304)
        assertEquals(second.body, "")
      })
    ))

  it.live("routes with URLPattern", () =>
    withApp((fetch) =>
      Effect.gen(function*() {
        assertEquals((yield* call(fetch, "/files/readme.md")).body, "readme (md)")
        assertEquals((yield* call(fetch, "/files/readme.md", { method: "POST" })).response.status, 404)
        assertEquals((yield* call(fetch, "/files/a.png?raw")).body, "raw")
        assertEquals((yield* call(fetch, "/files/a.png")).response.status, 404)
      })
    ))
})
