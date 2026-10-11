// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * Stream utilities for Effect's `Stream`, with Web Streams interop.
 *
 * `@std/streams` is a set of Web Streams helpers. Here they work on Effect's
 * `Stream`, so they compose with the rest of Effect (typed errors,
 * interruption, scopes), and convert to and from `ReadableStream` at the
 * edges:
 *
 * - Conversions: {@linkcode fromReadableStream}, {@linkcode toReadableStream},
 *   {@linkcode toByteStream}, {@linkcode toTransformStream},
 *   {@linkcode throughTransformStream}.
 * - Collectors, as Effects over a `Stream` or a `ReadableStream`:
 *   {@linkcode toText}, {@linkcode toBytes}, {@linkcode toArrayBuffer},
 *   {@linkcode toBlob}, and {@linkcode toJson}, which decodes with a Schema.
 * - Operators (data-first or data-last): {@linkcode lines}
 *   (`TextLineStream`), {@linkcode toLines}, {@linkcode delimit}
 *   (`DelimiterStream`), {@linkcode delimitText} (`TextDelimiterStream`),
 *   {@linkcode cappedDelimit} (`CappedDelimiterStream`),
 *   {@linkcode sliceBytes} (`ByteSliceStream`), {@linkcode fixedChunks}
 *   (`FixedChunkStream`), {@linkcode limitBytes}
 *   (`LimitedBytesTransformStream`), {@linkcode limit}
 *   (`LimitedTransformStream`), {@linkcode abortable} (`AbortStream`).
 * - Combinators over many streams: {@linkcode merge}
 *   (`mergeReadableStreams`), {@linkcode interleave}
 *   (`zipReadableStreams`), {@linkcode earlyInterleave}
 *   (`earlyZipReadableStreams`), {@linkcode concat}
 *   (`concatReadableStreams`).
 * - {@linkcode Buffer}, a growable byte buffer with a `Stream`, a `Sink` and
 *   Web Streams on both sides.
 *
 * Effect covers the rest of `@std/streams` directly: `BatchStream` is
 * `Stream.grouped`, `TextDecoderStream` / `TextEncoderStream` are
 * `Stream.decodeText` / `Stream.encodeText`.
 *
 * ```ts
 * import { Effect, Schema, Stream } from "effect"
 * import * as Streams from "@mikepage/flareosaur/streams"
 *
 * const Event = Schema.Struct({ id: Schema.Number })
 *
 * const program = Effect.gen(function*() {
 *   const response = new Response('{"id":1}\n{"id":2}\n')
 *   const ids = yield* Streams.fromReadableStream(response.body!).pipe(
 *     Streams.toLines(),
 *     Stream.mapEffect((line) => Schema.decodeEffect(Schema.fromJsonString(Event))(line)),
 *     Stream.map((event) => event.id),
 *     Stream.runCollect,
 *   )
 *   return ids // [1, 2]
 * })
 * ```
 *
 * @module
 */

import { Cause, Channel, Effect, Function, Option, Pull, Result, Schema, Sink, Stream } from "effect"
import type { NonEmptyReadonlyArray } from "effect/Array"
import { createLPS } from "./_std/_common.ts"

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

const StreamErrorBase: Schema.Class<
  StreamError,
  Schema.TaggedStruct<"StreamError", {
    readonly message: Schema.String
    readonly cause: Schema.Defect
  }>,
  Cause.YieldableError
> = Schema.TaggedError<StreamError>()("StreamError", {
  message: Schema.String,
  cause: Schema.Defect(),
})

/** Reading from or writing to a Web stream failed. */
export class StreamError extends StreamErrorBase {}

const LimitExceededErrorBase: Schema.Class<
  LimitExceededError,
  Schema.TaggedStruct<"LimitExceededError", {
    readonly unit: Schema.Literals<readonly ["bytes", "elements"]>
    readonly limit: Schema.Number
    readonly message: Schema.String
  }>,
  Cause.YieldableError
> = Schema.TaggedError<LimitExceededError>()("LimitExceededError", {
  unit: Schema.Literals(["bytes", "elements"]),
  limit: Schema.Number,
  message: Schema.String,
})

/** A stream produced more bytes or elements than its limit allows. */
export class LimitExceededError extends LimitExceededErrorBase {}

const AbortErrorBase: Schema.Class<
  AbortError,
  Schema.TaggedStruct<"AbortError", {
    readonly message: Schema.String
    readonly cause: Schema.Defect
  }>,
  Cause.YieldableError
> = Schema.TaggedError<AbortError>()("AbortError", {
  message: Schema.String,
  cause: Schema.Defect(),
})

/** A stream was aborted through an `AbortSignal`; `cause` is the signal's reason. */
export class AbortError extends AbortErrorBase {}

const BufferErrorBase: Schema.Class<
  BufferError,
  Schema.TaggedStruct<"BufferError", {
    readonly message: Schema.String
  }>,
  Cause.YieldableError
> = Schema.TaggedError<BufferError>()("BufferError", {
  message: Schema.String,
})

/** A {@linkcode Buffer} operation was out of range. */
export class BufferError extends BufferErrorBase {}

const messageOf = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause)

const streamError = (cause: unknown): StreamError => new StreamError({ message: messageOf(cause), cause })

const illegal = (message: string): Stream.Stream<never> => Stream.die(new Cause.IllegalArgumentError(message))

const isPositiveInteger = (n: number): boolean => Number.isInteger(n) && n > 0

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * What the collectors and combinators accept: an Effect `Stream` or a Web
 * `ReadableStream`. A `ReadableStream` read fails with {@linkcode StreamError}.
 */
export type Input<A, E = never, R = never> = Stream.Stream<A, E, R> | ReadableStream<A>

/** The element type of an {@linkcode Input}. */
export type InputElement<S> = S extends Stream.Stream<infer A, infer _E, infer _R> ? A
  : S extends ReadableStream<infer A> ? A
  : never

/** The error type of an {@linkcode Input}: {@linkcode StreamError} for a `ReadableStream`. */
export type InputError<S> = S extends Stream.Stream<infer _A, infer E, infer _R> ? E
  : S extends ReadableStream<infer _A> ? StreamError
  : never

/** The services an {@linkcode Input} needs. */
export type InputServices<S> = S extends Stream.Stream<infer _A, infer _E, infer R> ? R : never

const isInput = (u: unknown): u is Input<unknown, unknown, unknown> =>
  Stream.isStream(u) || (typeof ReadableStream !== "undefined" && u instanceof ReadableStream)

/** Turns an {@linkcode Input} into a `Stream`. */
export const fromInput = <S extends Input<any, any, any>>(
  input: S,
): Stream.Stream<InputElement<S>, InputError<S>, InputServices<S>> =>
  (Stream.isStream(input) ? input : fromReadableStream(input as ReadableStream<unknown>)) as any

// ---------------------------------------------------------------------------
// Conversions
// ---------------------------------------------------------------------------

/** Options for {@linkcode fromReadableStream}. */
export interface FromReadableStreamOptions {
  /**
   * Release the reader's lock when the stream ends instead of cancelling
   * the `ReadableStream`, so it can be read further. Defaults to `false`.
   */
  readonly releaseLockOnEnd?: boolean | undefined
}

/**
 * A `Stream` that reads a `ReadableStream`. Read errors fail the stream with
 * {@linkcode StreamError}. When the `Stream` ends early (interrupted, or a
 * `take`), the `ReadableStream` is cancelled.
 *
 * ```ts
 * import { Stream } from "effect"
 * import * as Streams from "@mikepage/flareosaur/streams"
 *
 * const stream = Streams.fromReadableStream(ReadableStream.from([1, 2, 3]))
 * Stream.runCollect(stream) // Effect<[1, 2, 3], StreamError>
 * ```
 */
export const fromReadableStream = <A>(
  readable: ReadableStream<A>,
  options?: FromReadableStreamOptions,
): Stream.Stream<A, StreamError> =>
  Stream.fromReadableStream({
    evaluate: () => readable,
    onError: streamError,
    releaseLockOnEnd: options?.releaseLockOnEnd,
  })

/**
 * A `ReadableStream` that runs a `Stream` as it is read; Effect's
 * `Stream.toReadableStream`. A failure errors the `ReadableStream`, and
 * cancelling it interrupts the `Stream`.
 */
export const toReadableStream: {
  <A>(options?: { readonly strategy?: QueuingStrategy<A> | undefined }): <E>(self: Stream.Stream<A, E>) => ReadableStream<A>
  <A, E>(self: Stream.Stream<A, E>, options?: { readonly strategy?: QueuingStrategy<A> | undefined }): ReadableStream<A>
} = Stream.toReadableStream

/**
 * A byte `ReadableStream` (`type: "bytes"`) that runs a `Stream` of bytes,
 * so it can be read with a BYOB reader (`getReader({ mode: "byob" })`).
 * Chunks are copied as they are handed over.
 *
 * ```ts
 * import { Stream } from "effect"
 * import * as Streams from "@mikepage/flareosaur/streams"
 *
 * const readable = Streams.toByteStream(Stream.make(new Uint8Array([1, 2, 3])))
 * const reader = readable.getReader({ mode: "byob" })
 * ```
 */
export const toByteStream = <E>(self: Stream.Stream<Uint8Array, E>): ReadableStream<Uint8Array> => {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  return new ReadableStream({
    type: "bytes",
    async pull(controller) {
      reader ??= Stream.toReadableStream(self).getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          controller.close()
          controller.byobRequest?.respond(0)
          return
        }
        if (value.byteLength > 0) {
          // enqueue() transfers the chunk's buffer; hand over a copy.
          controller.enqueue(value.slice())
          return
        }
      }
    },
    async cancel(reason) {
      await reader?.cancel(reason)
    },
  })
}

/** Options for {@linkcode toTransformStream}. */
export interface ToTransformStreamOptions<I, O> {
  readonly writableStrategy?: QueuingStrategy<I> | undefined
  readonly readableStrategy?: QueuingStrategy<O> | undefined
}

/**
 * A `TransformStream` whose readable side is `f` applied to what is written
 * to its writable side, for passing an Effect stream transformation to Web
 * APIs (`readable.pipeThrough(...)`). `f` receives the written chunks as a
 * `Stream` that fails with {@linkcode StreamError} if the writer aborts.
 *
 * ```ts
 * import { Stream } from "effect"
 * import * as Streams from "@mikepage/flareosaur/streams"
 *
 * const doubled = ReadableStream.from([1, 2, 3])
 *   .pipeThrough(Streams.toTransformStream(Stream.map((n: number) => n * 2)))
 * ```
 */
export const toTransformStream = <I, O, E>(
  f: (input: Stream.Stream<I, StreamError>) => Stream.Stream<O, E>,
  options?: ToTransformStreamOptions<I, O>,
): TransformStream<I, O> => {
  const { writable, readable } = new TransformStream<I, I>(undefined, options?.writableStrategy)
  return {
    writable,
    readable: Stream.toReadableStream(f(fromReadableStream(readable)), { strategy: options?.readableStrategy }),
  }
}

/**
 * Pipes a `Stream` through a Web `TransformStream` (such as
 * `CompressionStream` or `TextDecoderStream`). `transform` is called each
 * time the stream runs. Errors of the `TransformStream` fail the stream
 * with {@linkcode StreamError}.
 *
 * ```ts
 * import { Stream } from "effect"
 * import * as Streams from "@mikepage/flareosaur/streams"
 *
 * const gzipped = Stream.make(new TextEncoder().encode("hello")).pipe(
 *   Streams.throughTransformStream(() => new CompressionStream("gzip")),
 * )
 * ```
 */
export const throughTransformStream: {
  <I, O>(transform: () => TransformStream<I, O>): <E, R>(self: Stream.Stream<I, E, R>) => Stream.Stream<O, E | StreamError, R>
  <I, O, E, R>(self: Stream.Stream<I, E, R>, transform: () => TransformStream<I, O>): Stream.Stream<O, E | StreamError, R>
} = Function.dual(
  2,
  <I, O, E, R>(self: Stream.Stream<I, E, R>, transform: () => TransformStream<I, O>): Stream.Stream<O, E | StreamError, R> =>
    Stream.pipeThroughChannel(
      self,
      Channel.fromTransformStream<E, I, O, StreamError>({ evaluate: transform, onError: streamError }),
    ),
)

// ---------------------------------------------------------------------------
// Collectors
// ---------------------------------------------------------------------------

/**
 * Collects a stream of strings or UTF-8 bytes into one string.
 *
 * ```ts
 * import * as Streams from "@mikepage/flareosaur/streams"
 *
 * Streams.toText(new Response("hello").body!) // Effect<"hello", StreamError>
 * ```
 */
export const toText = <S extends Input<string | Uint8Array, any, any>>(
  input: S,
): Effect.Effect<string, InputError<S>, InputServices<S>> =>
  Effect.suspend(() => {
    const decoder = new TextDecoder()
    return fromInput(input).pipe(
      Stream.runFold(
        () => "",
        (text, chunk: string | Uint8Array) =>
          text + (typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true })),
      ),
      Effect.map((text) => text + decoder.decode()),
    )
  }) as any

/**
 * Collects a stream of bytes into one `Uint8Array`.
 *
 * ```ts
 * import * as Streams from "@mikepage/flareosaur/streams"
 *
 * Streams.toBytes(ReadableStream.from([new Uint8Array([1]), new Uint8Array([2])])) // Uint8Array [1, 2]
 * ```
 */
export const toBytes = <S extends Input<Uint8Array, any, any>>(
  input: S,
): Effect.Effect<Uint8Array, InputError<S>, InputServices<S>> => Stream.mkUint8Array(fromInput(input) as any) as any

/** Collects a stream of bytes into one `ArrayBuffer`. */
export const toArrayBuffer = <S extends Input<Uint8Array, any, any>>(
  input: S,
): Effect.Effect<ArrayBuffer, InputError<S>, InputServices<S>> => Stream.mkArrayBuffer(fromInput(input) as any) as any

/** Options for {@linkcode toBlob}. */
export interface ToBlobOptions {
  /** The Blob's media type. */
  readonly type?: string | undefined
}

/**
 * Collects a stream of bytes into a `Blob`.
 *
 * ```ts
 * import * as Streams from "@mikepage/flareosaur/streams"
 *
 * Streams.toBlob(new Response("hi").body!, { type: "text/plain" }) // Effect<Blob, StreamError>
 * ```
 */
export const toBlob = <S extends Input<Uint8Array, any, any>>(
  input: S,
  options?: ToBlobOptions,
): Effect.Effect<Blob, InputError<S>, InputServices<S>> =>
  Effect.map(
    Stream.runCollect(fromInput(input) as Stream.Stream<Uint8Array, unknown, unknown>),
    (chunks) => new Blob(chunks as Array<BlobPart>, options?.type === undefined ? undefined : { type: options.type }),
  ) as any

/**
 * Collects a stream of strings or UTF-8 bytes and decodes the text as JSON
 * with a Schema (`Schema.Unknown` when omitted). Invalid JSON and values
 * that do not match fail with a `SchemaError`.
 *
 * ```ts
 * import { Schema } from "effect"
 * import * as Streams from "@mikepage/flareosaur/streams"
 *
 * const User = Schema.Struct({ name: Schema.String })
 * Streams.toJson(new Response('{"name":"ada"}').body!, User) // Effect<{ name: string }, StreamError | SchemaError>
 * ```
 */
export const toJson = <S extends Input<string | Uint8Array, any, any>, T extends Schema.Top = Schema.Unknown>(
  input: S,
  schema?: T,
): Effect.Effect<T["Type"], InputError<S> | Schema.SchemaError, InputServices<S> | T["DecodingServices"]> =>
  Effect.flatMap(
    toText(input as Input<string | Uint8Array, unknown, unknown>),
    (text) => Schema.decodeEffect(Schema.fromJsonString(schema ?? Schema.Unknown))(text),
  ) as any

// ---------------------------------------------------------------------------
// Lines and delimiters
// ---------------------------------------------------------------------------

/** Options for {@linkcode lines} and {@linkcode toLines}. */
export interface LinesOptions {
  /**
   * Also end lines at a lone `\r`, not only at `\n` and `\r\n`. Defaults to
   * `false`.
   */
  readonly allowCR?: boolean | undefined
}

const splitLinesLF = <E, R>(self: Stream.Stream<string, E, R>): Stream.Stream<string, E, R> =>
  Stream.mapAccum(
    self,
    () => "",
    (pending: string, chunk: string) => {
      if (!chunk.includes("\n")) return [pending + chunk, []]
      const parts = (pending + chunk).split("\n")
      const rest = parts.pop()!
      return [rest, parts.map((line) => line.endsWith("\r") ? line.slice(0, -1) : line)]
    },
    { onHalt: (pending) => pending.length > 0 ? [pending] : [] },
  )

/**
 * Splits a stream of strings into lines, at `\n` and `\r\n` (and a lone
 * `\r` with `allowCR`). Line terminators are dropped, and a final newline
 * does not produce an empty last line. Data-first or data-last.
 *
 * ```ts
 * import { Stream } from "effect"
 * import * as Streams from "@mikepage/flareosaur/streams"
 *
 * Stream.make("a\nb\r", "\nc").pipe(Streams.lines(), Stream.runCollect) // ["a", "b", "c"]
 * ```
 */
export const lines: {
  (options?: LinesOptions): <E, R>(self: Stream.Stream<string, E, R>) => Stream.Stream<string, E, R>
  <E, R>(self: Stream.Stream<string, E, R>, options?: LinesOptions): Stream.Stream<string, E, R>
} = Function.dual(
  (args) => Stream.isStream(args[0]),
  <E, R>(self: Stream.Stream<string, E, R>, options?: LinesOptions): Stream.Stream<string, E, R> =>
    options?.allowCR ? Stream.splitLines(self) : splitLinesLF(self),
)

const decodeUtf8 = <E, R>(self: Stream.Stream<Uint8Array, E, R>): Stream.Stream<string, E, R> =>
  Stream.mapAccum(
    self,
    () => new TextDecoder(),
    (decoder, chunk: Uint8Array) => [decoder, [decoder.decode(chunk, { stream: true })]],
    { onHalt: (decoder) => [decoder.decode()] },
  )

/**
 * Decodes a stream of UTF-8 bytes and splits it into lines, like
 * {@linkcode lines}. Data-first or data-last.
 *
 * ```ts
 * import { Stream } from "effect"
 * import * as Streams from "@mikepage/flareosaur/streams"
 *
 * Streams.fromReadableStream(new Response("a\nb\n").body!).pipe(Streams.toLines(), Stream.runCollect) // ["a", "b"]
 * ```
 */
export const toLines: {
  (options?: LinesOptions): <E, R>(self: Stream.Stream<Uint8Array, E, R>) => Stream.Stream<string, E, R>
  <E, R>(self: Stream.Stream<Uint8Array, E, R>, options?: LinesOptions): Stream.Stream<string, E, R>
} = Function.dual(
  (args) => Stream.isStream(args[0]),
  <E, R>(self: Stream.Stream<Uint8Array, E, R>, options?: LinesOptions): Stream.Stream<string, E, R> =>
    lines(decodeUtf8(self), options),
)

/**
 * Where the delimiter goes in the chunks {@linkcode delimit} and
 * {@linkcode delimitText} emit: dropped (`"discard"`), at the end of the
 * chunk it ends (`"suffix"`), or at the start of the chunk it begins
 * (`"prefix"`).
 */
export type DelimiterDisposition = "discard" | "suffix" | "prefix"

/** Options for {@linkcode delimit} and {@linkcode delimitText}. */
export interface DelimitOptions {
  /** Where the delimiter goes. Defaults to `"discard"`. */
  readonly disposition?: DelimiterDisposition | undefined
}

interface Sequence<T> {
  readonly length: (t: T) => number
  readonly at: (t: T, i: number) => number
  readonly slice: (t: T, start: number, end: number) => T
  readonly concat: (parts: ReadonlyArray<T>) => T
}

const concatBytes = (parts: ReadonlyArray<Uint8Array>): Uint8Array => {
  if (parts.length === 1) return parts[0]!
  let length = 0
  for (const part of parts) length += part.byteLength
  const out = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.byteLength
  }
  return out
}

const bytesSequence: Sequence<Uint8Array> = {
  length: (t) => t.byteLength,
  at: (t, i) => t[i]!,
  slice: (t, start, end) => t.subarray(start, end),
  concat: concatBytes,
}

const textSequence: Sequence<string> = {
  length: (t) => t.length,
  at: (t, i) => t.charCodeAt(i),
  slice: (t, start, end) => t.slice(start, end),
  concat: (parts) => parts.join(""),
}

// Knuth-Morris-Pratt prefix table over code units.
const prefixTable = <T>(seq: Sequence<T>, pattern: T): Uint32Array => {
  const length = seq.length(pattern)
  const lps = new Uint32Array(length)
  let prefixEnd = 0
  for (let i = 1; i < length;) {
    if (seq.at(pattern, i) === seq.at(pattern, prefixEnd)) lps[i++] = ++prefixEnd
    else if (prefixEnd === 0) lps[i++] = 0
    else prefixEnd = lps[prefixEnd - 1]!
  }
  return lps
}

interface DelimitState<T> {
  pending: Array<T>
  pendingLength: number
  match: number
}

const splitOn = <T, E, R>(
  seq: Sequence<T>,
  self: Stream.Stream<T, E, R>,
  delimiter: T,
  lps: ArrayLike<number>,
  disposition: DelimiterDisposition,
): Stream.Stream<T, E, R> => {
  const delimiterLength = seq.length(delimiter)
  return Stream.mapAccum(
    self,
    (): DelimitState<T> => ({ pending: [], pendingLength: 0, match: 0 }),
    (state, chunk: T) => {
      const out: Array<T> = []
      const length = seq.length(chunk)
      // chunk[start..] has not been moved to state.pending yet. Positions in
      // "virtual" coordinates count from the start of the pending data.
      let start = 0
      for (let i = 0; i < length;) {
        if (seq.at(chunk, i) === seq.at(delimiter, state.match)) {
          i++
          if (++state.match < delimiterLength) continue
          state.match = 0
          const toVirtual = (index: number) => state.pendingLength + index - start
          const delimiterStart = i - delimiterLength
          const contentEnd = toVirtual(disposition === "suffix" ? i : delimiterStart)
          const nextStart = toVirtual(disposition === "prefix" ? delimiterStart : i)
          const joined = seq.concat(state.pending)
          out.push(
            contentEnd <= state.pendingLength
              ? seq.slice(joined, 0, contentEnd)
              : seq.concat([joined, seq.slice(chunk, start, start + contentEnd - state.pendingLength)]),
          )
          if (nextStart < state.pendingLength) {
            state.pending = [seq.slice(joined, nextStart, state.pendingLength)]
            state.pendingLength -= nextStart
          } else {
            start += nextStart - state.pendingLength
            state.pending = []
            state.pendingLength = 0
          }
        } else if (state.match === 0) {
          i++
        } else {
          state.match = lps[state.match - 1]!
        }
      }
      if (start < length) {
        state.pending.push(seq.slice(chunk, start, length))
        state.pendingLength += length - start
      }
      return [state, out]
    },
    { onHalt: (state) => [seq.concat(state.pending)] },
  )
}

/**
 * Splits a stream of bytes at a delimiter. The delimiter can span chunks.
 * The bytes after the last delimiter are emitted when the stream ends, as
 * an empty chunk when there are none. Data-first or data-last.
 *
 * ```ts
 * import { Stream } from "effect"
 * import * as Streams from "@mikepage/flareosaur/streams"
 *
 * const bytes = new TextEncoder().encode("a\r\nb\r\nc")
 * Stream.make(bytes).pipe(Streams.delimit(new TextEncoder().encode("\r\n")), Stream.runCollect)
 * // [a, b, c] as bytes
 * ```
 */
export const delimit: {
  (delimiter: Uint8Array, options?: DelimitOptions): <E, R>(self: Stream.Stream<Uint8Array, E, R>) => Stream.Stream<Uint8Array, E, R>
  <E, R>(self: Stream.Stream<Uint8Array, E, R>, delimiter: Uint8Array, options?: DelimitOptions): Stream.Stream<Uint8Array, E, R>
} = Function.dual(
  (args) => Stream.isStream(args[0]),
  <E, R>(self: Stream.Stream<Uint8Array, E, R>, delimiter: Uint8Array, options?: DelimitOptions) =>
    delimiter.byteLength === 0
      ? illegal("The delimiter must not be empty")
      : splitOn(bytesSequence, self, delimiter, createLPS(delimiter), options?.disposition ?? "discard"),
)

/**
 * Splits a stream of strings at a delimiter, like {@linkcode delimit}.
 * Data-first or data-last.
 *
 * ```ts
 * import { Stream } from "effect"
 * import * as Streams from "@mikepage/flareosaur/streams"
 *
 * Stream.make("a,b", ",c").pipe(Streams.delimitText(","), Stream.runCollect) // ["a", "b", "c"]
 * ```
 */
export const delimitText: {
  (delimiter: string, options?: DelimitOptions): <E, R>(self: Stream.Stream<string, E, R>) => Stream.Stream<string, E, R>
  <E, R>(self: Stream.Stream<string, E, R>, delimiter: string, options?: DelimitOptions): Stream.Stream<string, E, R>
} = Function.dual(
  (args) => Stream.isStream(args[0]),
  <E, R>(self: Stream.Stream<string, E, R>, delimiter: string, options?: DelimitOptions) =>
    delimiter.length === 0
      ? illegal("The delimiter must not be empty")
      : splitOn(textSequence, self, delimiter, prefixTable(textSequence, delimiter), options?.disposition ?? "discard"),
)

/** A chunk emitted by {@linkcode cappedDelimit}. */
export interface CappedDelimiterEntry {
  /**
   * `true` when the chunk ended at a delimiter, `false` when it was cut at
   * the limit (the next chunk continues it) or the stream ended.
   */
  readonly match: boolean
  readonly value: Uint8Array
}

/** Options for {@linkcode cappedDelimit}. */
export interface CappedDelimitOptions {
  /** The bytes to split at; dropped from the output. */
  readonly delimiter: Uint8Array
  /** The largest chunk to emit, in bytes. */
  readonly limit: number
}

const indexOfBytes = (haystack: Uint8Array, needle: Uint8Array, last: number): number => {
  outer: for (let i = 0; i <= last; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer
    }
    return i
  }
  return -1
}

/**
 * Splits a stream of bytes at a delimiter, emitting at most `limit` bytes
 * per chunk: a longer run is cut into chunks marked `match: false`. Use it
 * to parse delimited input without buffering unbounded amounts of it.
 * Data-first or data-last.
 *
 * ```ts
 * import { Stream } from "effect"
 * import * as Streams from "@mikepage/flareosaur/streams"
 *
 * Stream.make(new Uint8Array([1, 0, 2, 2, 2, 2])).pipe(
 *   Streams.cappedDelimit({ delimiter: new Uint8Array([0]), limit: 3 }),
 *   Stream.runCollect,
 * )
 * // [{ match: true, value: [1] }, { match: false, value: [2, 2, 2] }, { match: false, value: [2] }]
 * ```
 */
export const cappedDelimit: {
  (options: CappedDelimitOptions): <E, R>(self: Stream.Stream<Uint8Array, E, R>) => Stream.Stream<CappedDelimiterEntry, E, R>
  <E, R>(self: Stream.Stream<Uint8Array, E, R>, options: CappedDelimitOptions): Stream.Stream<CappedDelimiterEntry, E, R>
} = Function.dual(2, <E, R>(self: Stream.Stream<Uint8Array, E, R>, { delimiter, limit }: CappedDelimitOptions) => {
  if (delimiter.byteLength === 0) return illegal("The delimiter must not be empty")
  if (!isPositiveInteger(limit)) return illegal(`The limit must be a positive integer: received ${limit}`)
  const window = limit + delimiter.byteLength
  const drain = (pending: Uint8Array, out: Array<CappedDelimiterEntry>, final: boolean): Uint8Array => {
    while (pending.byteLength > 0) {
      const searchEnd = Math.min(pending.byteLength, window) - delimiter.byteLength
      const index = indexOfBytes(pending, delimiter, searchEnd)
      if (index !== -1) {
        out.push({ match: true, value: pending.slice(0, index) })
        pending = pending.subarray(index + delimiter.byteLength)
      } else if (pending.byteLength >= window || final) {
        out.push({ match: false, value: pending.slice(0, limit) })
        pending = pending.subarray(Math.min(limit, pending.byteLength))
      } else {
        break
      }
    }
    return pending
  }
  return Stream.mapAccum(
    self,
    () => new Uint8Array(0),
    (pending: Uint8Array, chunk: Uint8Array) => {
      const out: Array<CappedDelimiterEntry> = []
      const rest = drain(pending.byteLength === 0 ? chunk : concatBytes([pending, chunk]), out, false)
      return [rest, out]
    },
    {
      onHalt: (pending) => {
        const out: Array<CappedDelimiterEntry> = []
        drain(pending, out, true)
        return out
      },
    },
  )
})

// ---------------------------------------------------------------------------
// Slicing and limits
// ---------------------------------------------------------------------------

/**
 * Keeps the bytes from offset `start` to offset `end`, both inclusive, of a
 * stream of bytes, and stops reading once past `end`. Data-first or
 * data-last.
 *
 * ```ts
 * import { Stream } from "effect"
 * import * as Streams from "@mikepage/flareosaur/streams"
 *
 * Stream.make(new Uint8Array([0, 1, 2, 3, 4])).pipe(Streams.sliceBytes(1, 3), Stream.runCollect) // [[1, 2, 3]]
 * ```
 */
export const sliceBytes: {
  (start?: number, end?: number): <E, R>(self: Stream.Stream<Uint8Array, E, R>) => Stream.Stream<Uint8Array, E, R>
  <E, R>(self: Stream.Stream<Uint8Array, E, R>, start?: number, end?: number): Stream.Stream<Uint8Array, E, R>
} = Function.dual(
  (args) => Stream.isStream(args[0]),
  <E, R>(self: Stream.Stream<Uint8Array, E, R>, start = 0, end = Infinity): Stream.Stream<Uint8Array, E, R> => {
    if (!(start >= 0)) return illegal(`start must be >= 0: received ${start}`)
    const stop = end + 1
    return self.pipe(
      Stream.mapAccum(() => 0, (offset: number, chunk: Uint8Array) => {
        const next = offset + chunk.byteLength
        const bytes = chunk.subarray(Math.max(0, start - offset), Math.max(0, Math.min(chunk.byteLength, stop - offset)))
        return [next, [{ bytes, last: next >= stop }]]
      }),
      Stream.takeUntil((entry) => entry.last),
      Stream.map((entry) => entry.bytes),
      Stream.filter((bytes) => bytes.byteLength > 0),
    )
  },
)

/**
 * Re-chunks a stream of bytes into chunks of exactly `size` bytes; the last
 * chunk holds what is left. Data-first or data-last.
 *
 * ```ts
 * import { Stream } from "effect"
 * import * as Streams from "@mikepage/flareosaur/streams"
 *
 * Stream.make(new Uint8Array([1, 2, 3, 4, 5])).pipe(Streams.fixedChunks(2), Stream.runCollect)
 * // [[1, 2], [3, 4], [5]]
 * ```
 */
export const fixedChunks: {
  (size: number): <E, R>(self: Stream.Stream<Uint8Array, E, R>) => Stream.Stream<Uint8Array, E, R>
  <E, R>(self: Stream.Stream<Uint8Array, E, R>, size: number): Stream.Stream<Uint8Array, E, R>
} = Function.dual(2, <E, R>(self: Stream.Stream<Uint8Array, E, R>, size: number) => {
  if (!isPositiveInteger(size)) return illegal(`size must be a positive integer: received ${size}`)
  return Stream.mapAccum(
    self,
    () => new Uint8Array(0),
    (pending: Uint8Array, chunk: Uint8Array) => {
      const data = pending.byteLength === 0 ? chunk : concatBytes([pending, chunk])
      const out: Array<Uint8Array> = []
      let offset = 0
      for (; offset + size <= data.byteLength; offset += size) out.push(data.slice(offset, offset + size))
      return [data.slice(offset), out]
    },
    { onHalt: (pending) => pending.byteLength > 0 ? [pending] : [] },
  )
})

/** Options for {@linkcode limitBytes} and {@linkcode limit}. */
export interface LimitOptions<Mode extends "fail" | "truncate" = "fail" | "truncate"> {
  /**
   * What happens when the limit is exceeded: fail with
   * {@linkcode LimitExceededError} (`"fail"`, the default), or end the
   * stream (`"truncate"`).
   */
  readonly onExceeded?: Mode | undefined
}

/**
 * Limits a stream of bytes to `size` bytes. The chunk that would exceed
 * the limit is not emitted; the stream then fails with
 * {@linkcode LimitExceededError}, or ends with `onExceeded: "truncate"`.
 * Delegates to `Stream.limitBytes`. Data-first or data-last.
 *
 * ```ts
 * import { Stream } from "effect"
 * import * as Streams from "@mikepage/flareosaur/streams"
 *
 * const body = Stream.make(new Uint8Array(10), new Uint8Array(10))
 * body.pipe(Streams.limitBytes(16), Stream.runCollect) // fails with LimitExceededError
 * body.pipe(Streams.limitBytes(16, { onExceeded: "truncate" }), Stream.runCollect) // [first chunk]
 * ```
 */
export const limitBytes: {
  (size: number, options: LimitOptions<"truncate">): <E, R>(self: Stream.Stream<Uint8Array, E, R>) => Stream.Stream<Uint8Array, E, R>
  (size: number, options?: LimitOptions<"fail">): <E, R>(self: Stream.Stream<Uint8Array, E, R>) => Stream.Stream<Uint8Array, E | LimitExceededError, R>
  <E, R>(self: Stream.Stream<Uint8Array, E, R>, size: number, options: LimitOptions<"truncate">): Stream.Stream<Uint8Array, E, R>
  <E, R>(self: Stream.Stream<Uint8Array, E, R>, size: number, options?: LimitOptions<"fail">): Stream.Stream<Uint8Array, E | LimitExceededError, R>
} = Function.dual(
  (args) => Stream.isStream(args[0]),
  <E, R>(self: Stream.Stream<Uint8Array, E, R>, size: number, options?: LimitOptions) =>
    Stream.limitBytes(
      self as Stream.Stream<Uint8Array, E | LimitExceededError, R>,
      size,
      () =>
        options?.onExceeded === "truncate"
          ? Stream.empty
          : Stream.fail(
            new LimitExceededError({ unit: "bytes", limit: size, message: `Exceeded byte size limit of '${size}'` }),
          ),
    ),
)

/**
 * Limits a stream to `n` elements. When more arrive, the stream fails with
 * {@linkcode LimitExceededError}, or ends with `onExceeded: "truncate"`
 * (which is `Stream.take(n)`). Data-first or data-last.
 *
 * ```ts
 * import { Stream } from "effect"
 * import * as Streams from "@mikepage/flareosaur/streams"
 *
 * Stream.make(1, 2, 3).pipe(Streams.limit(2), Stream.runCollect) // fails with LimitExceededError
 * ```
 */
export const limit: {
  (n: number, options: LimitOptions<"truncate">): <A, E, R>(self: Stream.Stream<A, E, R>) => Stream.Stream<A, E, R>
  (n: number, options?: LimitOptions<"fail">): <A, E, R>(self: Stream.Stream<A, E, R>) => Stream.Stream<A, E | LimitExceededError, R>
  <A, E, R>(self: Stream.Stream<A, E, R>, n: number, options: LimitOptions<"truncate">): Stream.Stream<A, E, R>
  <A, E, R>(self: Stream.Stream<A, E, R>, n: number, options?: LimitOptions<"fail">): Stream.Stream<A, E | LimitExceededError, R>
} = Function.dual(
  (args) => Stream.isStream(args[0]),
  <A, E, R>(self: Stream.Stream<A, E, R>, n: number, options?: LimitOptions) =>
    options?.onExceeded === "truncate"
      ? Stream.take(self, n)
      : Stream.suspend(() => {
        let count = 0
        let exceeded = false
        return Stream.concat(
          Stream.takeWhile(self, () => {
            if (count >= n) {
              exceeded = true
              return false
            }
            count++
            return true
          }),
          Stream.suspend(() =>
            exceeded
              ? Stream.fail(new LimitExceededError({ unit: "elements", limit: n, message: `Exceeded chunk limit of '${n}'` }))
              : Stream.empty
          ),
        )
      }),
)

/**
 * Fails the stream with {@linkcode AbortError} as soon as `signal` aborts,
 * interrupting the upstream; immediately if it already has. Data-first or
 * data-last.
 *
 * ```ts
 * import { Stream } from "effect"
 * import * as Streams from "@mikepage/flareosaur/streams"
 *
 * const controller = new AbortController()
 * const stream = Stream.never.pipe(Streams.abortable(controller.signal))
 * controller.abort("stop") // the stream fails with AbortError({ cause: "stop" })
 * ```
 */
export const abortable: {
  (signal: AbortSignal): <A, E, R>(self: Stream.Stream<A, E, R>) => Stream.Stream<A, E | AbortError, R>
  <A, E, R>(self: Stream.Stream<A, E, R>, signal: AbortSignal): Stream.Stream<A, E | AbortError, R>
} = Function.dual(2, <A, E, R>(self: Stream.Stream<A, E, R>, signal: AbortSignal) =>
  Stream.interruptWhen(
    self,
    Effect.callback<never, AbortError>((resume) => {
      const onAbort = () =>
        resume(Effect.fail(new AbortError({ message: `Aborted: ${messageOf(signal.reason)}`, cause: signal.reason })))
      if (signal.aborted) return onAbort()
      signal.addEventListener("abort", onAbort, { once: true })
      return Effect.sync(() => signal.removeEventListener("abort", onAbort))
    }),
  ))

// ---------------------------------------------------------------------------
// Many streams
// ---------------------------------------------------------------------------

/**
 * Merges streams, emitting elements as soon as any stream produces them.
 * The result ends when all inputs end, and fails as soon as one fails.
 *
 * ```ts
 * import { Stream } from "effect"
 * import * as Streams from "@mikepage/flareosaur/streams"
 *
 * Streams.merge(Stream.make(1, 2), ReadableStream.from([3])) // Stream<number, StreamError>
 * ```
 */
export const merge = <const S extends ReadonlyArray<Input<any, any, any>>>(
  ...streams: S
): Stream.Stream<InputElement<S[number]>, InputError<S[number]>, InputServices<S[number]>> =>
  Stream.mergeAll(streams.map(fromInput), { concurrency: "unbounded" }) as any

/**
 * Concatenates streams: each starts when the previous one ends.
 *
 * ```ts
 * import { Stream } from "effect"
 * import * as Streams from "@mikepage/flareosaur/streams"
 *
 * Streams.concat(Stream.make(1, 2), ReadableStream.from([3])) // 1, 2, 3
 * ```
 */
export const concat = <const S extends ReadonlyArray<Input<any, any, any>>>(
  ...streams: S
): Stream.Stream<InputElement<S[number]>, InputError<S[number]>, InputServices<S[number]>> =>
  streams.reduce<Stream.Stream<any, any, any>>((all, stream) => Stream.concat(all, fromInput(stream)), Stream.empty)

interface Source<A, E> {
  readonly pull: Pull.Pull<NonEmptyReadonlyArray<A>, E>
  buffer: ReadonlyArray<A>
  index: number
}

const nextElement = <A, E>(source: Source<A, E>): Effect.Effect<Option.Option<A>, E> =>
  source.index < source.buffer.length
    ? Effect.succeed(Option.some(source.buffer[source.index++]!))
    : Pull.catchDone(
      Effect.map(source.pull, (chunk) => {
        source.buffer = chunk
        source.index = 1
        return Option.some(chunk[0])
      }),
      () => Effect.succeed(Option.none<A>()),
    )

const roundRobin = <A, E, R>(
  streams: ReadonlyArray<Stream.Stream<A, E, R>>,
  endOnFirst: boolean,
): Stream.Stream<A, E, R> =>
  Stream.unwrap(Effect.gen(function*() {
    const sources: Array<Source<A, E>> = []
    for (const stream of streams) sources.push({ pull: yield* Stream.toPull(stream), buffer: [], index: 0 })
    let finished = false
    const pull = Effect.gen(function*() {
      while (true) {
        if (finished || sources.length === 0) return yield* Cause.done()
        const round: Array<A> = []
        for (let i = 0; i < sources.length;) {
          const next = yield* nextElement(sources[i]!)
          if (Option.isSome(next)) {
            round.push(next.value)
            i++
          } else if (endOnFirst) {
            finished = true
            break
          } else {
            sources.splice(i, 1)
          }
        }
        if (round.length > 0) return round as unknown as NonEmptyReadonlyArray<A>
      }
    })
    return Stream.fromPull(Effect.succeed(pull))
  }))

/**
 * Interleaves streams round-robin: one element from each stream in turn.
 * A stream that ends drops out; the result ends when all have ended. This
 * is `@std/streams`' `zipReadableStreams`; for pairs use `Stream.zip`.
 *
 * ```ts
 * import { Stream } from "effect"
 * import * as Streams from "@mikepage/flareosaur/streams"
 *
 * Streams.interleave(Stream.make(1, 2, 3), Stream.make("a")) // 1, "a", 2, 3
 * ```
 */
export const interleave = <const S extends ReadonlyArray<Input<any, any, any>>>(
  ...streams: S
): Stream.Stream<InputElement<S[number]>, InputError<S[number]>, InputServices<S[number]>> =>
  roundRobin(streams.map(fromInput), false) as any

/**
 * Interleaves streams round-robin like {@linkcode interleave}, but ends as
 * soon as any stream ends, and stops reading the others. This is
 * `@std/streams`' `earlyZipReadableStreams`.
 *
 * ```ts
 * import { Stream } from "effect"
 * import * as Streams from "@mikepage/flareosaur/streams"
 *
 * Streams.earlyInterleave(Stream.make(1, 2, 3), Stream.make("a")) // 1, "a", 2
 * ```
 */
export const earlyInterleave = <const S extends ReadonlyArray<Input<any, any, any>>>(
  ...streams: S
): Stream.Stream<InputElement<S[number]>, InputError<S[number]>, InputServices<S[number]>> =>
  roundRobin(streams.map(fromInput), true) as any

// ---------------------------------------------------------------------------
// Buffer
// ---------------------------------------------------------------------------

const MAX_SIZE = 2 ** 32 - 2
const DEFAULT_CHUNK_SIZE = 16_640

/** Options for {@linkcode Buffer.bytes}. */
export interface BufferBytesOptions {
  /** Return a copy (the default) instead of a view of the buffer's memory. */
  readonly copy?: boolean | undefined
}

/**
 * A growable byte buffer, read and written as Effect streams or Web
 * streams. Reading consumes bytes from the front; writing appends.
 *
 * ```ts
 * import { Effect, Stream } from "effect"
 * import * as Streams from "@mikepage/flareosaur/streams"
 *
 * const program = Effect.gen(function*() {
 *   const buffer = new Streams.Buffer()
 *   yield* Stream.make(new Uint8Array([1, 2]), new Uint8Array([3])).pipe(Stream.run(buffer.sink))
 *   buffer.length // 3
 *   return yield* Stream.runCollect(buffer.stream()) // [Uint8Array [1, 2, 3]]
 * })
 * ```
 */
export class Buffer {
  #buf: Uint8Array
  #off = 0

  /** A buffer over `init` (an `ArrayBuffer` is used as is, an array is copied), or an empty one. */
  constructor(init?: ArrayLike<number> | ArrayBufferLike) {
    this.#buf = init === undefined ? new Uint8Array(0) : new Uint8Array(init as ArrayLike<number>)
  }

  /** The number of unread bytes. */
  get length(): number {
    return this.#buf.byteLength - this.#off
  }

  /** The size of the underlying memory, in bytes. */
  get capacity(): number {
    return this.#buf.buffer.byteLength
  }

  /** Whether there are no unread bytes. */
  empty(): boolean {
    return this.length === 0
  }

  /** The unread bytes, copied unless `copy: false`. */
  bytes(options?: BufferBytesOptions): Uint8Array {
    const view = this.#buf.subarray(this.#off)
    return options?.copy === false ? view : view.slice()
  }

  /** Discards all bytes, keeping the memory. */
  reset(): void {
    this.#buf = new Uint8Array(this.#buf.buffer, 0, 0)
    this.#off = 0
  }

  /** Keeps the first `n` unread bytes and discards the rest. */
  truncate(n: number): Result.Result<void, BufferError> {
    if (n === 0) {
      this.reset()
      return Result.succeed(undefined)
    }
    if (!(n >= 0 && n <= this.length)) {
      return Result.fail(new BufferError({ message: `Buffer truncation value "${n}" is not between 0 and ${this.length}` }))
    }
    this.#buf = new Uint8Array(this.#buf.buffer, 0, this.#off + n)
    return Result.succeed(undefined)
  }

  // Makes room for n more bytes and returns the offset to write them at.
  #ensure(n: number): Result.Result<number, BufferError> {
    const length = this.length
    if (length === 0 && this.#off !== 0) this.reset()
    const end = this.#buf.byteOffset + this.#buf.byteLength
    if (end + n <= this.capacity) {
      this.#buf = new Uint8Array(this.#buf.buffer, 0, end + n)
      return Result.succeed(end)
    }
    if (length + n > MAX_SIZE) {
      return Result.fail(new BufferError({ message: `The buffer cannot grow beyond the maximum size of ${MAX_SIZE}` }))
    }
    const unread = this.#buf.subarray(this.#off)
    const next = length + n <= Math.floor(this.capacity / 2)
      ? new Uint8Array(this.#buf.buffer)
      : new Uint8Array(Math.min(2 * this.capacity + n, MAX_SIZE))
    next.set(unread, 0)
    this.#buf = new Uint8Array(next.buffer, 0, length + n)
    this.#off = 0
    return Result.succeed(length)
  }

  /** Ensures room for `n` more bytes without another allocation. */
  grow(n: number): Result.Result<void, BufferError> {
    if (n < 0) return Result.fail(new BufferError({ message: `Cannot grow buffer as growth must be positive: received ${n}` }))
    const length = this.length
    return Result.map(this.#ensure(n), () => {
      this.#buf = new Uint8Array(this.#buf.buffer, 0, this.#off + length)
    })
  }

  /** Appends bytes. */
  write(chunk: Uint8Array): Result.Result<void, BufferError> {
    return Result.map(this.#ensure(chunk.byteLength), (offset) => {
      this.#buf.set(chunk, offset)
    })
  }

  /** Removes and returns up to `max` unread bytes, or `None` when empty. */
  read(max: number = DEFAULT_CHUNK_SIZE): Option.Option<Uint8Array> {
    if (this.empty()) {
      this.reset()
      return Option.none()
    }
    const chunk = this.#buf.slice(this.#off, this.#off + Math.max(1, max))
    this.#off += chunk.byteLength
    return Option.some(chunk)
  }

  /**
   * A stream that reads the buffer until it is empty, in chunks of up to
   * `chunkSize` bytes.
   */
  stream(chunkSize: number = DEFAULT_CHUNK_SIZE): Stream.Stream<Uint8Array> {
    return Stream.fromPull(Effect.sync(() =>
      Effect.suspend(() => {
        const chunk = this.read(chunkSize)
        return Option.isSome(chunk) ? Effect.succeed([chunk.value] as const) : Cause.done()
      })
    ))
  }

  /** A sink that writes every chunk into the buffer. */
  get sink(): Sink.Sink<void, Uint8Array, never, BufferError> {
    return Sink.forEach((chunk: Uint8Array) => Effect.fromResult(this.write(chunk)))
  }

  /** A byte `ReadableStream` that reads the buffer until it is empty. */
  get readable(): ReadableStream<Uint8Array> {
    return toByteStream(this.stream())
  }

  /** A `WritableStream` that appends to the buffer. */
  get writable(): WritableStream<Uint8Array> {
    return new WritableStream({
      write: (chunk) => {
        const result = this.write(chunk)
        if (Result.isFailure(result)) throw result.failure
      },
    })
  }
}
