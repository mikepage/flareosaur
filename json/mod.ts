// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * JSON streaming formats and canonical JSON, for Effect.
 *
 * Effect covers plain JSON (`Schema.fromJsonString`, `Schema.Json`) and
 * newline-delimited JSON (`effect/encoding/Ndjson`). This module adds what it
 * lacks, from `@std/json`:
 *
 * - {@linkcode parseConcatenated}: a `Stream` of JSON values written back to
 *   back (`{"a":1}{"b":2} 3`), split across arbitrary chunks.
 * - {@linkcode parseSequence} / {@linkcode stringifySequence}: JSON text
 *   sequences (RFC 7464, `application/json-seq`), each value prefixed with
 *   the record separator `\x1E`.
 * - {@linkcode canonicalize} / {@linkcode canonicalizeToBytes}: the JSON
 *   Canonicalization Scheme (RFC 8785), a deterministic serialization to hash
 *   or sign.
 * - {@linkcode parseLines} / {@linkcode stringifyLines}: JSON Lines through
 *   Effect's `Ndjson`, reporting the same {@linkcode JsonError}.
 *
 * ```ts
 * import { Effect, Stream } from "effect"
 * import * as Json from "@mikepage/flareosaur/json"
 *
 * const program = Effect.gen(function*() {
 *   const values = yield* Stream.make('{"b":2,"a":1}[t', "rue] 3").pipe(Json.parseConcatenated, Stream.runCollect)
 *   // [{ b: 2, a: 1 }, [true], 3]
 *   return yield* Json.canonicalize(values[0]!) // '{"a":1,"b":2}'
 * })
 * ```
 *
 * @module
 */

import { Effect, Schema, SchemaGetter, SchemaIssue, SchemaTransformation, Stream } from "effect"
import * as Ndjson from "effect/encoding/Ndjson"
import { canonicalize as stdCanonicalize } from "./_std/canonicalize.ts"

/** JSON text could not be parsed, or a value could not be serialized. */
export class JsonError extends Schema.TaggedError<JsonError>()("JsonError", {
  kind: Schema.Literals(["Parse", "Stringify"]),
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

const messageOf = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause)

const truncate = (text: string): string => text.length > 30 ? `${text.slice(0, 30)}...` : text

const parseError = (cause: unknown, text: string) =>
  new JsonError({ kind: "Parse", message: `${messageOf(cause)} (parsing: '${truncate(text)}')`, cause })

const stringifyError = (cause: unknown) => new JsonError({ kind: "Stringify", message: messageOf(cause), cause })

/** Parses one JSON text. The error message quotes the start of the input. */
export const parse = (text: string): Effect.Effect<Schema.Json, JsonError> =>
  Effect.try({ try: () => JSON.parse(text) as Schema.Json, catch: (cause) => parseError(cause, text) })

/** Options for {@linkcode stringify}. */
export interface StringifyOptions {
  /** Indentation, as for `JSON.stringify`. */
  readonly space?: string | number | undefined
}

/**
 * Serializes a value as JSON. Fails on cycles, `BigInt`s, and values JSON
 * cannot represent at all (a top-level function, symbol or `undefined`).
 */
export const stringify = (value: unknown, options?: StringifyOptions): Effect.Effect<string, JsonError> =>
  Effect.try({
    try: () => {
      const text = JSON.stringify(value, null, options?.space)
      if (text === undefined) throw new TypeError("The value cannot be represented as JSON")
      return text
    },
    catch: stringifyError,
  })

// ---------------------------------------------------------------------------
// Canonical JSON (RFC 8785)
// ---------------------------------------------------------------------------

const canonicalizeUnsafe = (value: Schema.Json): string => {
  const text: unknown = stdCanonicalize(value as Parameters<typeof stdCanonicalize>[0])
  if (typeof text !== "string") throw new TypeError("The value cannot be represented as JSON")
  return text
}

/**
 * Serializes a JSON value with the JSON Canonicalization Scheme (RFC 8785):
 * object keys sorted by UTF-16 code units, no whitespace, ECMAScript number
 * formatting, `-0` as `0`. Equal values always give the same text, so it can
 * be hashed or signed. Object properties that are `undefined` are omitted.
 * Fails on non-finite numbers and cycles.
 */
export const canonicalize = (value: Schema.Json): Effect.Effect<string, JsonError> =>
  Effect.try({ try: () => canonicalizeUnsafe(value), catch: stringifyError })

const encoder = new TextEncoder()

/**
 * {@linkcode canonicalize} encoded as UTF-8: the exact bytes RFC 8785 says to
 * hash or sign, ready for `crypto.subtle.digest`.
 */
export const canonicalizeToBytes = (value: Schema.Json): Effect.Effect<Uint8Array<ArrayBuffer>, JsonError> =>
  Effect.map(canonicalize(value), (text) => encoder.encode(text))

const issue = (error: unknown, input: unknown) => new SchemaIssue.InvalidValue({ message: messageOf(error) }, input)

/** A transformation between JSON text and the value it holds, encoding as canonical JSON. */
export const canonicalTransformation: SchemaTransformation.Transformation<unknown, string> =
  new SchemaTransformation.Transformation(
    SchemaGetter.transformEffect((text: string) =>
      Effect.try({ try: (): unknown => JSON.parse(text), catch: (e) => issue(e, text) })
    ),
    SchemaGetter.transformEffect((value: unknown) =>
      Effect.try({ try: () => canonicalizeUnsafe(value as Schema.Json), catch: (e) => issue(e, value) })
    ),
  )

/**
 * A Schema that decodes JSON text into `S` and encodes `S` as canonical JSON
 * (RFC 8785), so encoding equal values always yields the same string.
 *
 * ```ts
 * import { Schema } from "effect"
 * import * as Json from "@mikepage/flareosaur/json"
 *
 * const encode = Schema.encodeSync(Json.canonicalSchema(Schema.Struct({ b: Schema.Number, a: Schema.Number })))
 * encode({ b: 2, a: 1 }) // '{"a":1,"b":2}'
 * ```
 */
export const canonicalSchema = <S extends Schema.Top>(target: S) =>
  Schema.String.pipe(Schema.decodeTo(target, canonicalTransformation))

// ---------------------------------------------------------------------------
// Concatenated JSON
// ---------------------------------------------------------------------------

const isBlankChar = (char: string | undefined): boolean =>
  char === " " || char === "\t" || char === "\r" || char === "\n"

const primitives = new Map<string | undefined, "null" | "true" | "false">([["n", "null"], ["t", "true"], ["f", "false"]])

// The splitter of std's ConcatenatedJsonParseStream, as a state machine that
// returns the complete JSON texts found in each chunk instead of parsing them.
class ConcatenatedSplitter {
  private target = ""
  private hasValue = false
  private nestCount = 0
  private readingString = false
  private escapeNext = false
  private readingPrimitive: false | "null" | "true" | "false" = false
  private positionInPrimitive = 0

  push(chunk: string): Array<string> {
    const out: Array<string> = []
    let sliceStart = 0
    const emit = (end: number) => {
      out.push(this.target + chunk.slice(sliceStart, end))
      this.hasValue = false
      this.target = ""
      sliceStart = end
    }
    for (let i = 0; i < chunk.length; i++) {
      const char = chunk[i]
      if (this.readingPrimitive) {
        if (char === this.readingPrimitive[this.positionInPrimitive]) {
          this.positionInPrimitive++
          if (this.positionInPrimitive === this.readingPrimitive.length) {
            emit(i + 1)
            this.readingPrimitive = false
            this.positionInPrimitive = 0
          }
        } else {
          // A malformed primitive: keep reading so the parse error shows more.
          this.readingPrimitive = false
          this.positionInPrimitive = 0
        }
        continue
      }
      if (this.readingString) {
        if (char === '"' && !this.escapeNext) {
          this.readingString = false
          if (this.nestCount === 0 && this.hasValue) emit(i + 1)
        }
        this.escapeNext = !this.escapeNext && char === "\\"
        continue
      }
      // A top-level number ends where the next value or a blank starts.
      if (
        this.hasValue && this.nestCount === 0 &&
        (char === "{" || char === "[" || char === '"' || char === " " || char === "n" || char === "t" ||
          char === "f")
      ) {
        emit(i)
        this.readingString = false
        i--
        continue
      }
      switch (char) {
        case '"':
          this.readingString = true
          this.escapeNext = false
          break
        case "{":
        case "[":
          this.nestCount++
          break
        case "}":
        case "]":
          this.nestCount--
          break
      }
      if (this.nestCount === 0 && primitives.has(char)) {
        this.readingPrimitive = primitives.get(char)!
        this.positionInPrimitive = 1
      }
      if (this.hasValue && this.nestCount === 0 && (char === "}" || char === "]")) {
        emit(i + 1)
        continue
      }
      if (!this.hasValue && !isBlankChar(char)) this.hasValue = true
    }
    this.target += chunk.slice(sliceStart)
    return out
  }

  flush(): Array<string> {
    return this.hasValue ? [this.target] : []
  }
}

/**
 * Parses a stream of text chunks holding concatenated JSON values, with or
 * without whitespace between them (`{"a":1}{"b":2}`, `1 2 "x"`). Values may
 * span chunks. Fails with a {@linkcode JsonError} on the first invalid value.
 */
export const parseConcatenated = <E, R>(self: Stream.Stream<string, E, R>): Stream.Stream<Schema.Json, E | JsonError, R> =>
  self.pipe(
    Stream.mapAccum(
      () => new ConcatenatedSplitter(),
      (splitter, chunk: string) => [splitter, splitter.push(chunk)] as const,
      { onHalt: (splitter) => splitter.flush() },
    ),
    Stream.mapEffect(parse),
  )

// ---------------------------------------------------------------------------
// JSON text sequences (RFC 7464)
// ---------------------------------------------------------------------------

const RS = "\x1E"

const blank = /^[ \t\r\n]*$/

const parseRecord = (record: string): Effect.Effect<Schema.Json, JsonError> => {
  // RFC 7464 §2.4: a top-level number not followed by whitespace may have
  // been truncated, so it is rejected rather than misread.
  const trimmed = record.trimStart()
  if (/^-?[0-9]/.test(trimmed) && !isBlankChar(record.at(-1))) {
    return Effect.fail(
      new JsonError({
        kind: "Parse",
        message: `Possibly truncated number in JSON text sequence (parsing: '${truncate(record)}')`,
        cause: undefined,
      }),
    )
  }
  return parse(record)
}

/**
 * Parses a JSON text sequence (RFC 7464, `application/json-seq`): each
 * value is preceded by the record separator `\x1E` and normally followed by
 * a line feed. Empty records are skipped. Values may span chunks.
 */
export const parseSequence = <E, R>(self: Stream.Stream<string, E, R>): Stream.Stream<Schema.Json, E | JsonError, R> =>
  self.pipe(
    Stream.mapAccum(
      () => ({ buffer: "" }),
      (state, chunk: string) => {
        const parts = (state.buffer + chunk).split(RS)
        state.buffer = parts.pop()!
        return [state, parts] as const
      },
      { onHalt: (state) => [state.buffer] },
    ),
    Stream.filter((record) => !blank.test(record)),
    Stream.mapEffect(parseRecord),
  )

/**
 * Serializes each value of a stream as a JSON text sequence record:
 * `\x1E`, the JSON text, and a line feed.
 */
export const stringifySequence = <A, E, R>(self: Stream.Stream<A, E, R>): Stream.Stream<string, E | JsonError, R> =>
  Stream.mapEffect(self, (value) => Effect.map(stringify(value), (text) => `${RS}${text}\n`))

// ---------------------------------------------------------------------------
// JSON Lines, through effect/encoding/Ndjson
// ---------------------------------------------------------------------------

const fromNdjson = (error: Ndjson.NdjsonError) =>
  new JsonError({
    kind: error.kind === "Pack" ? "Stringify" : "Parse",
    message: messageOf(error.cause),
    cause: error.cause,
  })

/**
 * Parses JSON Lines (newline-delimited JSON) with Effect's `Ndjson`
 * decoder. Blank lines are skipped; `\n` and `\r\n` both end a line.
 */
export const parseLines = <E, R>(self: Stream.Stream<string, E, R>): Stream.Stream<Schema.Json, E | JsonError, R> =>
  self.pipe(
    Stream.pipeThroughChannel(Ndjson.decodeString({ ignoreEmptyLines: true })),
    Stream.mapError((error) => Ndjson.isNdjsonError(error) ? fromNdjson(error) : error as E),
  ) as Stream.Stream<Schema.Json, E | JsonError, R>

/** Serializes each value of a stream as one line of JSON Lines, with Effect's `Ndjson` encoder. */
export const stringifyLines = <A, E, R>(self: Stream.Stream<A, E, R>): Stream.Stream<string, E | JsonError, R> =>
  self.pipe(
    Stream.pipeThroughChannel(Ndjson.encodeString()),
    Stream.mapError((error) => Ndjson.isNdjsonError(error) ? fromNdjson(error) : error as E),
  )
