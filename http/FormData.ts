// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * Streaming `multipart/form-data`: encode a `Stream` of form entries into a
 * request or response body, and decode a body into a `Stream` of parts,
 * without buffering whole files.
 *
 * Decoding delegates to `effect/http/Multipart` (std's
 * `FormDataDecoderStream`): {@linkcode decode} pipes bytes through
 * `Multipart.makeChannel`, and {@linkcode fromRequest} is the current
 * request's `multipartStream`; parts are `Multipart.Field` and
 * `Multipart.File` (whose `content` is a byte `Stream`), and limits come from
 * `Multipart.withLimits`. Effect has no streaming encoder, so
 * {@linkcode encode} runs std's `FormDataEncoderStream`.
 *
 * ```ts
 * import { Effect, Stream } from "effect"
 * import * as FormData from "@mikepage/flareosaur/http/form-data"
 *
 * const entries = Stream.make(
 *   { name: "title", value: "Report" },
 *   { name: "file", value: new Blob(["a,b\n1,2\n"], { type: "text/csv" }), filename: "data.csv" },
 * )
 *
 * const response = FormData.response(entries) // Effect<HttpServerResponse>
 * ```
 *
 * @module
 */

import { Effect, Schema, Stream } from "effect"
import { Headers, HttpServerRequest, HttpServerResponse, Multipart } from "effect/http"
import { FormDataEncoderStream, type FormDataInput } from "./_std/unstable_formdata_encoder_stream.ts"
import { message } from "./_internal.ts"

/** An entry to encode: a field name and a string, `Blob` or byte stream value. */
export type { FormDataInput }

/** Encoding a form entry failed (for example, its value stream errored). */
export class FormDataError extends Schema.TaggedError<FormDataError>()("FormDataError", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

/** An encoded `multipart/form-data` body and the `Content-Type` (with boundary) that goes with it. */
export interface Encoded {
  readonly contentType: string
  readonly body: Stream.Stream<Uint8Array, FormDataError>
}

/**
 * Encodes form entries as a `multipart/form-data` byte stream. Entries are
 * pulled as the body is read. A failure of `entries` surfaces as a
 * {@linkcode FormDataError} in the body.
 */
export const encode = <E, R>(entries: Stream.Stream<FormDataInput, E, R>): Effect.Effect<Encoded, never, R> =>
  Effect.map(Stream.toReadableStreamEffect(entries), (readable) => {
    const encoder = new FormDataEncoderStream(readable)
    return {
      contentType: encoder.contentType,
      body: Stream.fromReadableStream({
        evaluate: () => encoder.readable,
        onError: (cause) => new FormDataError({ message: message(cause), cause }),
      }),
    }
  })

/** A response whose body is the encoded form entries. */
export const response = <E, R>(
  entries: Stream.Stream<FormDataInput, E, R>,
  options?: HttpServerResponse.Options.WithContent,
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, R> =>
  Effect.map(encode(entries), ({ body, contentType }) => HttpServerResponse.stream(body, { ...options, contentType }))

/**
 * Decodes a `multipart/form-data` body into its parts. `headers` must carry
 * the `Content-Type` with the boundary.
 */
export const decode = <E, R>(
  body: Stream.Stream<Uint8Array, E, R>,
  headers: Headers.Headers | Readonly<Record<string, string>>,
): Stream.Stream<Multipart.Part, Multipart.MultipartError | E, R> =>
  body.pipe(Stream.pipeThroughChannel(Multipart.makeChannel<E>({ ...headers } as Record<string, string>)))

/** The parts of the current request's `multipart/form-data` body. */
export const fromRequest: Stream.Stream<Multipart.Part, Multipart.MultipartError, HttpServerRequest.HttpServerRequest> =
  Stream.unwrap(HttpServerRequest.HttpServerRequest.useSync((request) => request.multipartStream))
