// Copyright 2026 the flareosaur authors. MIT license.
// Helpers shared by the public modules of the http package.

import { Effect, Option, Result, SchemaIssue, SchemaTransformation } from "effect"
import { Headers } from "effect/http"

/** Anything that carries HTTP headers. */
export type HeadersInput =
  | Headers.Headers
  | globalThis.Headers
  | { readonly headers: Headers.Headers | globalThis.Headers }

const isWebHeaders = (u: unknown): u is globalThis.Headers =>
  typeof globalThis.Headers === "function" && u instanceof globalThis.Headers

export const isHeadersInput = (u: unknown): u is HeadersInput =>
  Headers.isHeaders(u) || isWebHeaders(u) ||
  (typeof u === "object" && u !== null && "headers" in u &&
    (Headers.isHeaders(u.headers) || isWebHeaders(u.headers)))

/** Reads a header (case-insensitive) from any {@linkcode HeadersInput}. */
export const header = (input: HeadersInput, name: string): Option.Option<string> => {
  const headers = Headers.isHeaders(input) || isWebHeaders(input) ? input : input.headers
  return isWebHeaders(headers)
    ? Option.fromNullishOr(headers.get(name))
    : Headers.get(headers, name)
}

export const message = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause)

/** A Schema transformation from Result-returning decode and encode functions. */
export const fromResults = <T, E, DE extends { readonly message: string }, EE extends { readonly message: string }>(
  decode: (e: E) => Result.Result<T, DE>,
  encode: (t: T) => Result.Result<E, EE>,
): SchemaTransformation.Transformation<T, E> =>
  SchemaTransformation.transformEffect({
    decode: (input: E) =>
      Effect.fromResult(decode(input)).pipe(
        Effect.mapError((error): SchemaIssue.Issue => new SchemaIssue.InvalidValue({ message: error.message }, input)),
      ),
    encode: (value: T) =>
      Effect.fromResult(encode(value)).pipe(
        Effect.mapError((error): SchemaIssue.Issue => new SchemaIssue.InvalidValue({ message: error.message }, value)),
      ),
  })
