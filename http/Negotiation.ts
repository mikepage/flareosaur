// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * Content negotiation: pick the media type, encoding or language a client
 * prefers from its `Accept`, `Accept-Encoding` and `Accept-Language`
 * headers, by quality value and specificity.
 *
 * Effect has no negotiation helpers. These are std's `accepts`,
 * `acceptsEncodings` and `acceptsLanguages`, working on Effect `Headers`,
 * an `HttpServerRequest`, or web `Headers`/`Request`:
 *
 * - {@linkcode mediaTypes} / {@linkcode encodings} / {@linkcode languages}
 *   list what the client accepts, most preferred first;
 * - {@linkcode accepts} / {@linkcode acceptsEncodings} /
 *   {@linkcode acceptsLanguages} pick the best of the values you offer, as an
 *   `Option` (`None` when the client accepts none of them);
 * - {@linkcode negotiate}, {@linkcode negotiateEncoding} and
 *   {@linkcode negotiateLanguage} do the same for the current
 *   `HttpServerRequest`, inside a route handler.
 *
 * ```ts
 * import { Effect, Option } from "effect"
 * import { HttpServerResponse } from "effect/http"
 * import * as Negotiation from "@mikepage/flareosaur/http/negotiation"
 *
 * const handler = Effect.gen(function*() {
 *   const type = yield* Negotiation.negotiate(["application/json", "text/html"])
 *   return Option.match(type, {
 *     onNone: () => HttpServerResponse.empty({ status: 406 }),
 *     onSome: (type) =>
 *       type === "text/html" ? HttpServerResponse.text("<p>hi</p>", { contentType: type }) : HttpServerResponse.jsonUnsafe({ hi: true }),
 *   })
 * })
 * ```
 *
 * @module
 */

import { type Effect, Function, Option } from "effect"
import { HttpServerRequest } from "effect/http"
import { accepts as stdAccepts, acceptsEncodings as stdEncodings, acceptsLanguages as stdLanguages } from "./_std/negotiation.ts"
import { header, type HeadersInput, isHeadersInput } from "./_internal.ts"

export type { HeadersInput }

const adapt = (input: HeadersInput): Pick<Request, "headers"> =>
  ({ headers: { get: (name: string) => Option.getOrNull(header(input, name)) } }) as unknown as Pick<Request, "headers">

/**
 * The media types the client accepts, most preferred first (`["*\/*"]` when
 * there is no `Accept` header).
 */
export const mediaTypes = (input: HeadersInput): ReadonlyArray<string> => stdAccepts(adapt(input))

/**
 * The content encodings the client accepts, most preferred first (`["*"]`
 * when there is no `Accept-Encoding` header).
 */
export const encodings = (input: HeadersInput): ReadonlyArray<string> => stdEncodings(adapt(input))

/**
 * The languages the client accepts, most preferred first (`["*"]` when there
 * is no `Accept-Language` header).
 */
export const languages = (input: HeadersInput): ReadonlyArray<string> => stdLanguages(adapt(input))

const pick = (
  f: (request: Pick<Request, "headers">, ...values: Array<string>) => string | undefined,
) =>
  Function.dual(
    (args) => isHeadersInput(args[0]),
    <T extends string>(input: HeadersInput, offered: ReadonlyArray<T>): Option.Option<T> =>
      offered.length === 0 ? Option.none() : Option.fromUndefinedOr(f(adapt(input), ...offered) as T | undefined),
  )

/** The signature shared by {@linkcode accepts}, {@linkcode acceptsEncodings} and {@linkcode acceptsLanguages}. */
export interface Picker {
  <T extends string>(offered: ReadonlyArray<T>): (input: HeadersInput) => Option.Option<T>
  <T extends string>(input: HeadersInput, offered: ReadonlyArray<T>): Option.Option<T>
}

/**
 * Picks the offered media type the client prefers. Without an `Accept`
 * header the first offered type wins.
 *
 * ```ts
 * import { Headers } from "effect/http"
 * import { accepts } from "@mikepage/flareosaur/http/negotiation"
 *
 * const headers = Headers.fromInput({ accept: "text/html, application/xml;q=0.9" })
 * accepts(headers, ["application/xml", "text/html"]) // Option.some("text/html")
 * ```
 */
export const accepts: Picker = pick(stdAccepts)

/** Picks the offered content encoding the client prefers. */
export const acceptsEncodings: Picker = pick(stdEncodings)

/** Picks the offered language the client prefers. */
export const acceptsLanguages: Picker = pick(stdLanguages)

/** {@linkcode accepts} for the current `HttpServerRequest`. */
export const negotiate = <T extends string>(
  offered: ReadonlyArray<T>,
): Effect.Effect<Option.Option<T>, never, HttpServerRequest.HttpServerRequest> =>
  HttpServerRequest.HttpServerRequest.useSync((request) => accepts(request, offered))

/** {@linkcode acceptsEncodings} for the current `HttpServerRequest`. */
export const negotiateEncoding = <T extends string>(
  offered: ReadonlyArray<T>,
): Effect.Effect<Option.Option<T>, never, HttpServerRequest.HttpServerRequest> =>
  HttpServerRequest.HttpServerRequest.useSync((request) => acceptsEncodings(request, offered))

/** {@linkcode acceptsLanguages} for the current `HttpServerRequest`. */
export const negotiateLanguage = <T extends string>(
  offered: ReadonlyArray<T>,
): Effect.Effect<Option.Option<T>, never, HttpServerRequest.HttpServerRequest> =>
  HttpServerRequest.HttpServerRequest.useSync((request) => acceptsLanguages(request, offered))
