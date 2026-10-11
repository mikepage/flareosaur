// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.
import { Effect, Option, Schema } from "effect"
import { Headers, HttpClientRequest, HttpClientResponse, HttpServerResponse } from "effect/http"
import { describe, it } from "../testing/mod.ts"
import { assert, assertEquals, assertFailsWithTag, assertFailure, assertFalse, assertSuccess } from "../assert/mod.ts"
import * as ProblemDetails from "./ProblemDetails.ts"

const body = (response: HttpServerResponse.HttpServerResponse) =>
  Effect.promise(() => HttpServerResponse.toWeb(response).json())

describe("ProblemDetails Schema", () => {
  it("accepts standard and extension members", () => {
    const is = Schema.is(ProblemDetails.ProblemDetails)
    assert(is({ type: "https://example.com/out-of-credit", status: 403, balance: 30 }))
    assert(is({}))
    assertFalse(is({ status: "403" }))
  })
})

describe("parse", () => {
  it("drops mistyped standard members and keeps extensions", () => {
    assertEquals(
      assertSuccess(ProblemDetails.parse({ type: 1, status: 403.5, title: "T", detail: null, instance: "/a", balance: 30 })),
      { title: "T", instance: "/a", balance: 30 },
    )
  })

  it("fails on non-objects", () => {
    for (const input of [null, [1], "x", 1]) {
      assertEquals(assertFailure(ProblemDetails.parse(input))._tag, "ProblemDetailsError")
    }
  })
})

describe("withDefaults / response", () => {
  it("fills in RFC defaults", () => {
    assertEquals(ProblemDetails.withDefaults({}), { type: "about:blank", status: 500, title: "Internal Server Error" })
    assertEquals(ProblemDetails.withDefaults({ status: 404 }), { type: "about:blank", status: 404, title: "Not Found" })
    assertEquals(ProblemDetails.withDefaults({ type: "https://e/x", status: 404 }), { type: "https://e/x", status: 404 })
  })

  it.effect("builds an application/problem+json response", () =>
    Effect.gen(function*() {
      const response = yield* ProblemDetails.response(
        { status: 403, detail: "Your balance is 30", balance: 30 },
        { headers: { "x-request-id": "1" }, statusText: "Nope" },
      )
      assertEquals(response.status, 403)
      assertEquals(response.statusText, "Nope")
      assertEquals(Headers.get(response.headers, "content-type"), Option.some("application/problem+json"))
      assertEquals(Headers.get(response.headers, "x-request-id"), Option.some("1"))
      assertEquals(yield* body(response), {
        status: 403,
        detail: "Your balance is 30",
        balance: 30,
        type: "about:blank",
        title: "Forbidden",
      })
    }))

  it.effect("fails on a non-integer status or unserializable members", () =>
    Effect.gen(function*() {
      yield* assertFailsWithTag(ProblemDetails.response({ status: 4.5 }), "ProblemDetailsError")
      yield* assertFailsWithTag(ProblemDetails.response({ big: 1n }), "ProblemDetailsError")
    }))
})

describe("Problem", () => {
  it("carries a problem object", () => {
    const p = ProblemDetails.problem(409, "Already exists", { id: "a" })
    assertEquals(p._tag, "Problem")
    assertEquals(p.problem, { id: "a", status: 409, detail: "Already exists" })
    assertEquals(new ProblemDetails.Problem({ status: 400, type: "https://e/bad", title: "Bad" }).problem, {
      status: 400,
      type: "https://e/bad",
      title: "Bad",
    })
  })

  it.effect("catchProblems turns failures into problem responses", () =>
    Effect.gen(function*() {
      const fromProblem = yield* ProblemDetails.catchProblems()(Effect.fail(ProblemDetails.problem(404, "gone")))
      assertEquals(fromProblem.status, 404)
      assertEquals(yield* body(fromProblem), { status: 404, detail: "gone", type: "about:blank", title: "Not Found" })

      const other = yield* ProblemDetails.catchProblems()(Effect.fail(new Error("secret")))
      assertEquals(other.status, 500)
      assertEquals(yield* body(other), { status: 500, type: "about:blank", title: "Internal Server Error" })

      const mapped = yield* ProblemDetails.catchProblems(
        Effect.fail({ code: 429 }),
        (e) => ProblemDetails.problem(e.code),
      )
      assertEquals(mapped.status, 429)

      const ok = yield* ProblemDetails.catchProblems()(Effect.succeed(HttpServerResponse.text("fine")))
      assertEquals(ok.status, 200)
    }))
})

describe("client side", () => {
  const clientResponse = (body: string, contentType: string) =>
    HttpClientResponse.fromWeb(
      HttpClientRequest.get("https://example.com/"),
      new Response(body, { status: 400, headers: { "content-type": contentType } }),
    )

  it("detects problem responses", () => {
    assert(ProblemDetails.isProblemResponse(new Response(null, { headers: { "content-type": "Application/Problem+JSON; charset=utf-8" } })))
    assertFalse(ProblemDetails.isProblemResponse(new Response(null, { headers: { "content-type": "application/json" } })))
    assertFalse(ProblemDetails.isProblemResponse(new Response(null)))
  })

  it.effect("reads the problem from an HttpClientResponse", () =>
    Effect.gen(function*() {
      assertEquals(
        yield* ProblemDetails.fromResponse(clientResponse(`{"title":"Bad","status":400}`, "application/problem+json")),
        Option.some({ title: "Bad", status: 400 }),
      )
      assertEquals(yield* ProblemDetails.fromResponse(clientResponse(`{}`, "application/json")), Option.none())
      yield* assertFailsWithTag(
        ProblemDetails.fromResponse(clientResponse(`[1]`, "application/problem+json")),
        "ProblemDetailsError",
      )
    }))
})
