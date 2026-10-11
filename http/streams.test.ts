// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.
// ServerSentEvents and FormData.
import { Duration, Effect, Option, Stream } from "effect"
import { Sse } from "effect/encoding"
import { Headers, HttpClientRequest, HttpClientResponse, HttpServerRequest, HttpServerResponse, Multipart } from "effect/http"
import { describe, it } from "../testing/mod.ts"
import { assertEquals, assertFailsWithTag, assertFailure, assertMatch, assertSuccess } from "../assert/mod.ts"
import * as FormData from "./FormData.ts"
import * as ServerSentEvents from "./ServerSentEvents.ts"

const bytes = (...chunks: Array<string>) => Stream.fromIterable(chunks.map((c) => new TextEncoder().encode(c)))
const text = <E>(stream: Stream.Stream<Uint8Array, E>) => Stream.mkString(Stream.decodeText(stream))

describe("ServerSentEvents.encode", () => {
  it("writes events, retries and comments", () => {
    assertEquals(assertSuccess(ServerSentEvents.encode(ServerSentEvents.event({ data: "hi" }))), "data: hi\n\n")
    assertEquals(
      assertSuccess(ServerSentEvents.encode(ServerSentEvents.event({ event: "update", id: "1", data: "a\r\nb\nc" }))),
      "id: 1\nevent: update\ndata: a\ndata: b\ndata: c\n\n",
    )
    assertEquals(assertSuccess(ServerSentEvents.encode(ServerSentEvents.retry("3 seconds"))), "retry: 3000\n\n")
    assertEquals(assertSuccess(ServerSentEvents.encode(ServerSentEvents.comment("ping\npong"))), ":ping\n:pong\n\n")
  })

  it("rejects newlines in event names and ids", () => {
    assertEquals(assertFailure(ServerSentEvents.encode(ServerSentEvents.event({ event: "a\nb", data: "" })))._tag, "ServerSentEventError")
    assertMatch(assertFailure(ServerSentEvents.encode(ServerSentEvents.event({ id: "1\r", data: "" }))).message, /id cannot contain a newline/)
  })
})

describe("ServerSentEvents.response", () => {
  it.effect("streams a text/event-stream response", () =>
    Effect.gen(function*() {
      const response = ServerSentEvents.response(
        Stream.make(ServerSentEvents.comment("hello"), ServerSentEvents.event({ event: "n", data: "1" })),
        { headers: { "x-a": "b" } },
      )
      const web = HttpServerResponse.toWeb(response)
      assertEquals(web.headers.get("content-type"), "text/event-stream")
      assertEquals(web.headers.get("cache-control"), "no-cache")
      assertEquals(web.headers.get("x-a"), "b")
      assertEquals(yield* Effect.promise(() => web.text()), ":hello\n\nevent: n\ndata: 1\n\n")
    }))

  it.effect("fails the body on an unencodable message", () =>
    Effect.gen(function*() {
      const body = ServerSentEvents.encodeStream(Stream.make(ServerSentEvents.event({ id: "\n", data: "" })))
      yield* assertFailsWithTag(Stream.runDrain(body), "ServerSentEventError")
    }))
})

describe("ServerSentEvents.decode", () => {
  it.effect("parses events split across chunks, keeping retries", () =>
    Effect.gen(function*() {
      const events = yield* Stream.runCollect(
        ServerSentEvents.decode(bytes("data: hel", "lo\n\nevent: up", "date\nid: 7\ndata: a\ndata: b\n\nretry: 500\n\n:c\ndata: x\n\n")),
      )
      assertEquals(events.length, 4)
      assertEquals(events[0], { _tag: "Event", event: "message", id: undefined, data: "hello" })
      assertEquals(events[1], { _tag: "Event", event: "update", id: "7", data: "a\nb" })
      const retry = events[2]!
      assertEquals(retry._tag, "Retry")
      if (Sse.Retry.is(retry)) assertEquals(Duration.toMillis(retry.duration), 500)
      assertEquals(events[3], { _tag: "Event", event: "message", id: "7", data: "x" })
    }))

  it.effect("round-trips through response and decodeResponse", () =>
    Effect.gen(function*() {
      const messages = [ServerSentEvents.event({ data: "1" }), ServerSentEvents.event({ event: "e", id: "2", data: "two\nlines" })]
      const web = HttpServerResponse.toWeb(ServerSentEvents.response(Stream.fromIterable(messages)))
      const client = HttpClientResponse.fromWeb(HttpClientRequest.get("https://x/"), web)
      assertEquals(yield* Stream.runCollect(ServerSentEvents.decodeResponse(client)), messages)
      const again = HttpServerResponse.toWeb(ServerSentEvents.response(Stream.fromIterable(messages)))
      assertEquals(yield* Stream.runCollect(ServerSentEvents.decodeReadable(again.body!)), messages)
    }))

  it.effect("fails on pending events above maxEventSize", () =>
    Effect.gen(function*() {
      yield* assertFailsWithTag(
        Stream.runDrain(ServerSentEvents.decode(bytes(`data: ${"x".repeat(100)}\n`, "\n"), { maxEventSize: 10 })),
        "SseError",
      )
    }))
})

describe("FormData", () => {
  it.effect("encodes entries as multipart/form-data", () =>
    Effect.gen(function*() {
      const { body, contentType } = yield* FormData.encode(
        Stream.make<Array<FormData.FormDataInput>>(
          { name: "title", value: "Report" },
          { name: "file", value: new Blob(["a,b"], { type: "text/csv" }), filename: "data.csv" },
        ),
      )
      assertMatch(contentType, /^multipart\/form-data; boundary="[^"]+"$/)
      const form = yield* Effect.promise(() =>
        new Response(Stream.toReadableStream(body), { headers: { "content-type": contentType } }).formData()
      )
      assertEquals(form.get("title"), "Report")
      const file = form.get("file") as File
      assertEquals(file.name, "data.csv")
      assertEquals(yield* Effect.promise(() => file.text()), "a,b")
    }))

  it.effect("decodes multipart bodies into parts", () =>
    Effect.gen(function*() {
      const form = new globalThis.FormData()
      form.set("a", "1")
      form.set("f", new File(["hello"], "h.txt", { type: "text/plain" }))
      const web = new Request("https://x/", { method: "POST", body: form })
      const headers = Headers.fromInput(web.headers)
      const body = Stream.fromReadableStream({ evaluate: () => web.body!, onError: (e) => e })
      const parts = yield* FormData.decode(body, headers).pipe(
        Stream.mapEffect((part) =>
          Multipart.isField(part)
            ? Effect.succeed([part.key, part.value] as const)
            : Effect.map(text(part.content), (content) => [part.key, `${part.name}:${content}`] as const)
        ),
        Stream.runCollect,
      )
      assertEquals(parts, [["a", "1"], ["f", "h.txt:hello"]])
    }))

  it.effect("round-trips through response and fromRequest", () =>
    Effect.gen(function*() {
      const response = yield* FormData.response(Stream.make({ name: "x", value: "y" }))
      const web = HttpServerResponse.toWeb(response)
      const request = new Request("https://x/", { method: "POST", headers: web.headers, body: web.body })
      const parts = yield* FormData.fromRequest.pipe(
        Stream.runCollect,
        Effect.provideService(HttpServerRequest.HttpServerRequest, HttpServerRequest.fromWeb(request)),
      )
      assertEquals(parts.map((p) => (Multipart.isField(p) ? Option.some(p.value) : Option.none())), [Option.some("y")])
    }))
})
