// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * Server-sent events: answer a request with a `text/event-stream` built
 * from a `Stream` of events, and parse an event stream body.
 *
 * `effect/encoding/Sse` holds the event model (`Sse.Event`, `Sse.Retry`),
 * the parser and the encoder; std's `ServerSentEventStream` and
 * `ServerSentEventParseStream` map onto it. This module adds the HTTP
 * glue: {@linkcode response} turns a `Stream` of messages into an
 * `HttpServerResponse`, {@linkcode decode} parses a byte stream into events
 * (keeping `retry:` directives as elements instead of ending the stream), and
 * {@linkcode comment} covers std's comment lines (handy as heartbeats), which
 * `Sse` has no model for.
 *
 * ```ts
 * import { Schedule, Stream } from "effect"
 * import { HttpRouter } from "effect/http"
 * import * as ServerSentEvents from "@mikepage/flareosaur/http/server-sent-events"
 *
 * const ticks = Stream.fromSchedule(Schedule.spaced("1 second")).pipe(
 *   Stream.map((n) => ServerSentEvents.event({ event: "tick", data: String(n), id: String(n) })),
 * )
 *
 * const route = HttpRouter.add("GET", "/events", ServerSentEvents.response(ticks))
 * ```
 *
 * @module
 */

import { type Cause, Duration, Effect, Result, Schema, Stream } from "effect"
import { Sse } from "effect/encoding"
import { type HttpClientError, type HttpClientResponse, HttpServerResponse } from "effect/http"
import { message as errorMessage } from "./_internal.ts"

/** A comment line (`: text`). Clients ignore it; servers send it to keep connections open. */
export interface Comment {
  readonly _tag: "Comment"
  readonly text: string
}

/** Anything {@linkcode encode} can write: an event, a retry directive or a comment. */
export type Message = Sse.Event | Sse.Retry | Comment

const ServerSentEventErrorBase: Schema.Class<
  ServerSentEventError,
  Schema.TaggedStruct<"ServerSentEventError", {
    readonly message: Schema.String
    readonly cause: Schema.Defect
  }>,
  Cause.YieldableError
> = Schema.TaggedError<ServerSentEventError>()("ServerSentEventError", {
  message: Schema.String,
  cause: Schema.Defect(),
})

/** A message cannot be written as a server-sent event (a newline in `event` or `id`). */
export class ServerSentEventError extends ServerSentEventErrorBase {}

/** Builds an `Sse.Event`. The event name defaults to `message`. */
export const event = (options: {
  readonly data: string
  readonly event?: string | undefined
  readonly id?: string | undefined
}): Sse.Event => ({ _tag: "Event", event: options.event ?? "message", id: options.id, data: options.data })

/** Builds a `retry:` directive, telling clients how long to wait before reconnecting. */
export const retry = (duration: Duration.Input, lastEventId?: string): Sse.Retry =>
  new Sse.Retry({ duration: Duration.fromInputUnsafe(duration), lastEventId })

/** Builds a comment line. */
export const comment = (text: string): Comment => ({ _tag: "Comment", text })

const NEWLINE = /\r\n|\r|\n/

/**
 * Writes one message in the `text/event-stream` format. Fails when the
 * event name or id contains a newline.
 */
export const encode = (message: Message): Result.Result<string, ServerSentEventError> => {
  switch (message._tag) {
    case "Comment":
      return Result.succeed(message.text.split(NEWLINE).map((line) => `:${line}`).join("\n") + "\n\n")
    case "Retry":
      return Result.succeed(Sse.encoder.write(message))
    case "Event": {
      for (const [name, value] of [["event", message.event], ["id", message.id]] as const) {
        if (value !== undefined && NEWLINE.test(value)) {
          return Result.fail(
            new ServerSentEventError({ message: `Cannot serialize message: ${name} cannot contain a newline`, cause: message }),
          )
        }
      }
      return Result.succeed(Sse.encoder.write({ ...message, data: message.data.split(NEWLINE).join("\n") }))
    }
  }
}

/** Encodes a stream of messages as `text/event-stream` bytes. */
export const encodeStream = <E, R>(
  messages: Stream.Stream<Message, E, R>,
): Stream.Stream<Uint8Array, E | ServerSentEventError, R> =>
  messages.pipe(
    Stream.mapEffect((message) => Effect.fromResult(encode(message))),
    Stream.encodeText,
  )

/**
 * A `text/event-stream` response streaming the messages, with
 * `Cache-Control: no-cache`. The response ends when the stream does.
 */
export const response = <E>(
  messages: Stream.Stream<Message, E>,
  options?: HttpServerResponse.Options.WithContent,
): HttpServerResponse.HttpServerResponse =>
  HttpServerResponse.stream(encodeStream(messages), {
    ...options,
    contentType: "text/event-stream",
    headers: { "cache-control": "no-cache", ...options?.headers },
  })

/**
 * Parses a `text/event-stream` byte stream into events and retry
 * directives. Fails with `Sse.SseError` when an event exceeds
 * `maxEventSize`.
 */
export const decode = <E, R>(
  body: Stream.Stream<Uint8Array, E, R>,
  options?: Sse.DecodeOptions,
): Stream.Stream<Sse.Event | Sse.Retry, E | Sse.SseError, R> =>
  Stream.suspend(() => {
    let buffer: Array<Sse.AnyEvent> = []
    const parser = Sse.makeParser((event) => buffer.push(event), options)
    return body.pipe(
      Stream.decodeText(),
      Stream.mapEffect((chunk) => {
        const error = parser.feed(chunk)
        const out = buffer
        buffer = []
        return error === undefined ? Effect.succeed(out) : Effect.fail(error)
      }),
      Stream.flattenIterable,
    )
  })

/** Parses the body of an `HttpClientResponse` as server-sent events. */
export const decodeResponse = (
  response: HttpClientResponse.HttpClientResponse,
  options?: Sse.DecodeOptions,
): Stream.Stream<Sse.Event | Sse.Retry, Sse.SseError | HttpClientError.HttpClientError> => decode(response.stream, options)

/** Parses a web `ReadableStream` (for example `fetch(...).body`) as server-sent events. */
export const decodeReadable = (
  readable: ReadableStream<Uint8Array>,
  options?: Sse.DecodeOptions,
): Stream.Stream<Sse.Event | Sse.Retry, Sse.SseError | ServerSentEventError> =>
  decode(
    Stream.fromReadableStream({
      evaluate: () => readable,
      onError: (cause) => new ServerSentEventError({ message: errorMessage(cause), cause }),
    }),
    options,
  )
