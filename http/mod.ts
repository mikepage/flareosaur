// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * HTTP utilities on top of `effect/http`: content negotiation, user agents,
 * `Cache-Control`, structured fields, signed cookies, message signatures,
 * problem details, entity tags, server-sent events and more.
 *
 * Most of `@std/http` already exists in Effect; use it directly:
 *
 * | std                                  | Effect / here                                              |
 * | ------------------------------------ | ---------------------------------------------------------- |
 * | `getCookies`, `setCookie`, `deleteCookie`, `getSetCookies` | `HttpServerRequest.cookies`, `HttpServerResponse.setCookie` / `expireCookie`, `Cookies` |
 * | `STATUS_CODE`, `STATUS_TEXT`, `isErrorStatus`, ... | {@linkcode Status} (and `HttpStatus.fromLiteral`)   |
 * | `METHOD` (unstable)                  | {@linkcode Method} (and `HttpMethod`)                       |
 * | `HEADER` (unstable)                  | {@linkcode Header} (and `Headers`)                          |
 * | `accepts`, `acceptsEncodings`, `acceptsLanguages` | {@linkcode Negotiation}                        |
 * | `UserAgent`                          | {@linkcode UserAgent}                                       |
 * | `eTag`, `ifMatch`, `ifNoneMatch`     | {@linkcode ETag} (with Effect's `Etag`)                     |
 * | `ServerSentEventStream`, `ServerSentEventParseStream` | {@linkcode ServerSentEvents} (with `effect/encoding/Sse`) |
 * | `parseCacheControl`, `formatCacheControl` (unstable) | {@linkcode CacheControl}                     |
 * | structured fields (unstable)         | {@linkcode StructuredFields}                                |
 * | signed cookies (unstable)            | {@linkcode SignedCookie}                                    |
 * | message signatures (unstable)        | {@linkcode MessageSignatures}                               |
 * | problem details, `HttpError` (unstable) | {@linkcode ProblemDetails}                               |
 * | `route` (unstable)                   | `HttpRouter`, or {@linkcode Route} for `URLPattern` routes  |
 * | `FormDataEncoderStream`, `FormDataDecoderStream` (unstable) | {@linkcode FormData} (decoding via `Multipart`) |
 * | `serveDir`, `serveFile`              | `HttpStaticServer` / `HttpServerResponse.file`; Workers serve assets themselves |
 *
 * Each module is also its own entrypoint, e.g.
 * `@mikepage/flareosaur/http/negotiation`.
 *
 * ```ts
 * import { Effect, Option } from "effect"
 * import { HttpRouter, HttpServerResponse } from "effect/http"
 * import { Negotiation, ProblemDetails } from "@mikepage/flareosaur/http"
 *
 * const Routes = HttpRouter.add(
 *   "GET",
 *   "/hello",
 *   Effect.gen(function*() {
 *     const type = yield* Negotiation.negotiate(["text/plain", "application/json"])
 *     if (Option.isNone(type)) return yield* ProblemDetails.problem(406)
 *     return type.value === "text/plain"
 *       ? HttpServerResponse.text("hello")
 *       : HttpServerResponse.jsonUnsafe({ hello: true })
 *   }),
 * )
 * ```
 *
 * @module
 */

export * as CacheControl from "./CacheControl.ts"
export * as ETag from "./Etag.ts"
export * as FormData from "./FormData.ts"
export * as Header from "./Header.ts"
export * as MessageSignatures from "./MessageSignatures.ts"
export * as Method from "./Method.ts"
export * as Negotiation from "./Negotiation.ts"
export * as ProblemDetails from "./ProblemDetails.ts"
export * as Route from "./Route.ts"
export * as ServerSentEvents from "./ServerSentEvents.ts"
export * as SignedCookie from "./SignedCookie.ts"
export * as Status from "./Status.ts"
export * as StructuredFields from "./StructuredFields.ts"
export * as UserAgent from "./UserAgent.ts"
