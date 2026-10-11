// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * `URLPattern` routing for Effect HTTP handlers.
 *
 * std's `unstable_route` maps onto `effect/http/HttpRouter`: use
 * `HttpRouter.add(method, "/users/:id", handler)` and
 * `HttpRouter.params` / `HttpRouter.schemaPathParams` for most apps. This
 * module is for routes `HttpRouter`'s path syntax cannot express (matching
 * on host, protocol, search or regular-expression groups, which
 * `URLPattern` supports): {@linkcode route} builds one handler from a list
 * of `URLPattern` routes, tried in order, with a fallback. Mount it with
 * `HttpRouter.add("*", "*", handler)`.
 *
 * ```ts
 * import { Effect } from "effect"
 * import { HttpRouter, HttpServerResponse } from "effect/http"
 * import * as Route from "@mikepage/flareosaur/http/route"
 *
 * const handler = Route.route(
 *   [
 *     Route.make({ hostname: "api.:tenant.example.com", pathname: "/users/:id" }, (match) =>
 *       Effect.succeed(HttpServerResponse.text(`${match.hostname.groups.tenant}: ${match.pathname.groups.id}`))),
 *   ],
 *   Effect.succeed(HttpServerResponse.empty({ status: 404 })),
 * )
 *
 * const Routes = HttpRouter.add("*", "*", handler)
 * ```
 *
 * @module
 */

import { Effect, Option } from "effect"
import { HttpServerRequest, type HttpServerResponse } from "effect/http"

/** A `URLPattern` route: the pattern, the methods it answers, and the handler. */
export interface Route<E = never, R = never> {
  readonly pattern: URLPattern
  /** The methods this route answers (case-insensitive); all when absent. */
  readonly method?: string | ReadonlyArray<string> | undefined
  readonly handler: (
    match: URLPatternResult,
    request: HttpServerRequest.HttpServerRequest,
  ) => Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>
}

/**
 * Builds a route. A string pattern is a pathname pattern
 * (`"/users/:id"`); pass a `URLPatternInit` or a `URLPattern` for more.
 */
export const make = <E = never, R = never>(
  pattern: string | URLPatternInit | URLPattern,
  handler: Route<E, R>["handler"],
  method?: string | ReadonlyArray<string>,
): Route<E, R> => ({
  pattern: pattern instanceof URLPattern
    ? pattern
    : new URLPattern(typeof pattern === "string" ? { pathname: pattern } : pattern),
  handler,
  method,
})

const methodMatches = (method: Route["method"], requestMethod: string): boolean =>
  method === undefined ||
  (typeof method === "string" ? [method] : method).some((m) => m.toUpperCase() === requestMethod)

/**
 * A handler that runs the first route whose method and pattern match the
 * current request, or `fallback` when none does.
 */
export const route = <Routes extends ReadonlyArray<Route<any, any>>, E2 = never, R2 = never>(
  routes: Routes,
  fallback: Effect.Effect<HttpServerResponse.HttpServerResponse, E2, R2>,
): Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  E2 | (Routes[number] extends Route<infer E, any> ? E : never),
  R2 | (Routes[number] extends Route<any, infer R> ? R : never) | HttpServerRequest.HttpServerRequest
> =>
  Effect.flatMap(Effect.service(HttpServerRequest.HttpServerRequest), (request) => {
    const url = HttpServerRequest.toURL(request)
    if (Option.isSome(url)) {
      for (const r of routes) {
        if (!methodMatches(r.method, request.method)) continue
        const match = r.pattern.exec(url.value.href)
        if (match) return r.handler(match, request)
      }
    }
    return fallback
  })
