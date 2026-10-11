// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * The IANA registry of permanent HTTP field names (std's `HEADER`), with a
 * Schema and a typed lookup into Effect `Headers`.
 *
 * Effect's `Headers` is a lowercase record with `Headers.get`; this module
 * adds named constants so header names are not typed as bare strings.
 *
 * ```ts
 * import { Option } from "effect"
 * import { Headers } from "effect/http"
 * import * as Header from "@mikepage/flareosaur/http/header"
 *
 * const headers = Headers.fromInput({ "content-type": "text/plain" })
 * Header.get(headers, Header.HEADER.ContentType) // Option.some("text/plain")
 * ```
 *
 * @module
 */

import { Function, type Option, Schema } from "effect"
import { HEADER, type Header as StdHeader } from "./_std/unstable_header.ts"
import { header, type HeadersInput } from "./_internal.ts"

export type { HeadersInput }

export {
  /** The permanent HTTP field names by name. */
  HEADER,
}

/** A permanent HTTP field name, as registered (mixed case). */
export type Header = StdHeader

/** A Schema for the registered field names (exact case). */
export const Header: Schema.Literals<ReadonlyArray<Header>> = Schema.Literals(Object.values(HEADER))

/**
 * Reads a header, case-insensitively, from Effect `Headers`, web `Headers`,
 * or anything with a `headers` property (requests and responses).
 */
export const get: {
  (name: Header | (string & {})): (self: HeadersInput) => Option.Option<string>
  (self: HeadersInput, name: Header | (string & {})): Option.Option<string>
} = Function.dual(2, (self: HeadersInput, name: string) => header(self, name))
