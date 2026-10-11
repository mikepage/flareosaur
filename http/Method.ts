// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * The IANA registry of HTTP methods (std's `METHOD`), with a Schema and a
 * bridge to Effect's `HttpMethod`.
 *
 * `effect/http/HttpMethod` covers the methods Effect's client and router
 * speak (`GET`, `POST`, ..., `QUERY`). This module keeps std's full registry
 * (WebDAV and friends) for code that has to recognise any registered method.
 *
 * ```ts
 * import { Option } from "effect"
 * import * as Method from "@mikepage/flareosaur/http/method"
 *
 * Method.METHOD.Propfind // "PROPFIND"
 * Method.isMethod("PROPFIND") // true
 * Method.toHttpMethod("GET") // Option.some("GET")
 * Method.toHttpMethod("PROPFIND") // Option.none()
 * ```
 *
 * @module
 */

import { Option, Schema } from "effect"
import { HttpMethod } from "effect/http"
import { METHOD, type Method as StdMethod } from "./_std/unstable_method.ts"

export {
  /** The registered HTTP methods by name. */
  METHOD,
}

/** A registered HTTP method. */
export type Method = StdMethod

/** A Schema for the registered HTTP methods. */
export const Method: Schema.Literals<ReadonlyArray<Method>> = Schema.Literals(Object.values(METHOD))

/** Whether a string is a registered HTTP method (case-sensitive). */
export const isMethod: (u: unknown) => u is Method = Schema.is(Method)

/**
 * Narrows a method to one Effect's `HttpMethod` supports. Matching is
 * case-insensitive.
 */
export const toHttpMethod = (method: string): Option.Option<HttpMethod.HttpMethod> => {
  const upper = method.toUpperCase()
  return HttpMethod.isHttpMethod(upper) ? Option.some(upper) : Option.none()
}
