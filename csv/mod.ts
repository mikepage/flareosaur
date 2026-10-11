// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * CSV parsing and stringifying, as Effects, Streams and Schema codecs.
 *
 * Effect has no CSV support. This module wraps `@std/csv` (a port of Go's
 * `encoding/csv`: quoted fields, multi-line values, custom separators,
 * comments, lazy quotes) for Effect:
 *
 * - {@linkcode parse} and {@linkcode stringify} return Effects that fail with
 *   a typed {@linkcode CsvError}.
 * - {@linkcode parseStream} turns a `Stream` of text chunks into a `Stream`
 *   of rows or records, and {@linkcode stringifyStream} goes the other way,
 *   so large files never have to be held in memory.
 * - {@linkcode schema} decodes CSV text with a header row into an array of
 *   typed values, and {@linkcode decodeStream} does the same row by row.
 *
 * ```ts
 * import { Effect, Schema, Stream } from "effect"
 * import * as Csv from "@mikepage/flareosaur/csv"
 *
 * const Person = Schema.Struct({ name: Schema.String, age: Schema.FiniteFromString })
 *
 * const program = Effect.gen(function*() {
 *   const people = yield* Schema.decodeEffect(Csv.schema(Person))("name,age\nRick,70\nMorty,14\n")
 *   // [{ name: "Rick", age: 70 }, { name: "Morty", age: 14 }]
 *   const rows = yield* Stream.make("a,b\n1,", "2\n").pipe(Csv.parseStream(), Stream.runCollect)
 *   // [["a", "b"], ["1", "2"]]
 *   return yield* Csv.stringify(people) // "name,age\r\nRick,70\r\nMorty,14\r\n"
 * })
 * ```
 *
 * @module
 */

import { Effect, Schema, SchemaGetter, SchemaIssue, SchemaTransformation, Stream } from "effect"
import { convertRowToObject, type LineReader, parseRecord, type ParseResult } from "./_std/_io.ts"
import { parse as stdParse, type ParseOptions, type RecordWithColumn } from "./_std/parse.ts"
import type { Column, ColumnDetails, DataItem, PropertyAccessor } from "./_std/stringify.ts"
import { stringify as stdStringify, type StringifyOptions } from "./_std/unstable_stringify.ts"

export type {
  Column,
  ColumnDetails,
  DataItem,
  ParseOptions,
  ParseResult,
  PropertyAccessor,
  RecordWithColumn,
  StringifyOptions,
}

/** CSV text could not be parsed, or rows could not be stringified. */
export class CsvError extends Schema.TaggedError<CsvError>()("CsvError", {
  kind: Schema.Literals(["Parse", "Stringify"]),
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

const messageOf = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause)

const parseError = (cause: unknown) => new CsvError({ kind: "Parse", message: messageOf(cause), cause })

const stringifyError = (cause: unknown) => new CsvError({ kind: "Stringify", message: messageOf(cause), cause })

/**
 * Parses CSV text. Without options it returns rows as string arrays. With
 * `skipFirstRow: true` the first row names the columns and each row becomes
 * a record; `columns` names them explicitly. Errors name the line and
 * column.
 */
export const parse = <const T extends ParseOptions = {}>(
  text: string,
  options?: T,
): Effect.Effect<ParseResult<ParseOptions, T>, CsvError> =>
  Effect.try({ try: () => stdParse(text, options ?? ({} as T)), catch: parseError })

/**
 * Stringifies rows as CSV, with CRLF line endings. Rows may be arrays, or
 * objects whose columns come from `columns` or, by default, from the keys
 * of the first object, written as a header row unless `headers: false`.
 * Objects and arrays inside fields are written as JSON.
 */
export const stringify = (
  data: ReadonlyArray<DataItem>,
  options?: StringifyOptions,
): Effect.Effect<string, CsvError> => Effect.try({ try: () => stdStringify(data, options), catch: stringifyError })

// ---------------------------------------------------------------------------
// Streams
// ---------------------------------------------------------------------------

/** Options for {@linkcode parseStream}. */
export interface ParseStreamOptions {
  /** Character which separates values. @default {","} */
  readonly separator?: string | undefined
  /** Character that starts a comment line. */
  readonly comment?: string | undefined
  /** Trim leading whitespace of each field. @default {false} */
  readonly trimLeadingSpace?: boolean | undefined
  /** Allow quotes inside unquoted fields and bare quotes in quoted fields. */
  readonly lazyQuotes?: boolean | undefined
  /**
   * The number of fields each record must have: unchecked when negative or
   * absent, taken from the first record when 0.
   */
  readonly fieldsPerRecord?: number | undefined
  /** Use the first row as column names and emit records. */
  readonly skipFirstRow?: boolean | undefined
  /** Column names; records are emitted with these keys. */
  readonly columns?: ReadonlyArray<string> | undefined
}

/** The element type of {@linkcode parseStream}: rows, or records when columns are named. */
export type RowType<T> = T extends undefined ? Array<string>
  : T extends { readonly columns: ReadonlyArray<infer C extends string> } ? RecordWithColumn<C>
  : T extends { readonly skipFirstRow: true } ? Record<string, string>
  : Array<string>

const NEED_MORE = Symbol("NeedMore")

// Serves the buffered lines that follow the first line of a record. When
// the buffer runs dry before the input ends, it aborts the attempt so the
// record is parsed again once more lines arrive.
class BufferReader implements LineReader {
  index = 0
  private done = false
  constructor(private readonly lines: ReadonlyArray<string>, private readonly eof: boolean) {}
  readLine(): Promise<string | null> {
    if (this.index < this.lines.length) return Promise.resolve(this.lines[this.index++]!)
    if (this.eof) {
      this.done = true
      return Promise.resolve(null)
    }
    return Promise.reject(NEED_MORE)
  }
  isEOF(): boolean {
    return this.done
  }
}

interface ParserState {
  readonly pending: Array<string>
  lineIndex: number
  first: boolean
  headers: ReadonlyArray<string>
  fieldsPerRecord: "ANY" | "UNINITIALIZED" | number
}

const stripLastCR = (line: string): string => line.endsWith("\r") ? line.slice(0, -1) : line

// Splits text chunks on "\n" (dropping a trailing "\r"), then appends an
// end marker so the record parser can tell the input is over.
const lines = <E, R>(self: Stream.Stream<string, E, R>): Stream.Stream<string | typeof NEED_MORE, E, R> =>
  self.pipe(
    Stream.mapAccum(
      () => ({ buffer: "", first: true }),
      (state, chunk: string) => {
        let text = state.buffer + chunk
        if (state.first && text.length > 0) {
          state.first = false
          if (text.startsWith("﻿")) text = text.slice(1)
        }
        const parts = text.split("\n")
        state.buffer = parts.pop()!
        return [state, parts.map(stripLastCR)] as const
      },
      { onHalt: (state): Array<string | typeof NEED_MORE> => [stripLastCR(state.buffer), NEED_MORE] },
    ),
  )

/**
 * Parses a stream of CSV text chunks into a stream of rows (string arrays),
 * or records when `skipFirstRow` or `columns` is set. Fields may span chunks
 * and lines. Blank lines are skipped. Fails with a {@linkcode CsvError} on
 * the first malformed record.
 */
export const parseStream = <const T extends ParseStreamOptions | undefined = undefined>(options?: T) =>
<E, R>(self: Stream.Stream<string, E, R>): Stream.Stream<RowType<T>, E | CsvError, R> => {
  const readOptions = { ...options, separator: options?.separator ?? ",", trimLeadingSpace: options?.trimLeadingSpace ?? false }
  const named = options?.skipFirstRow === true || options?.columns !== undefined

  const step = Effect.fnUntraced(function*(state: ParserState, line: string | typeof NEED_MORE) {
    const eof = line === NEED_MORE
    if (!eof) state.pending.push(line)
    const out: Array<RowType<T>> = []
    while (state.pending.length > 0) {
      if (state.pending[0] === "") {
        state.pending.shift()
        state.lineIndex++
        continue
      }
      const reader = new BufferReader(state.pending.slice(1), eof)
      const record = yield* Effect.tryPromise({
        try: () =>
          parseRecord(state.pending[0]!, reader, readOptions, state.lineIndex).catch((cause: unknown) =>
            cause === NEED_MORE ? undefined : Promise.reject(cause)
          ),
        catch: parseError,
      })
      if (record === undefined) break
      state.pending.splice(0, 1 + reader.index)

      if (state.first) {
        state.first = false
        if (options?.skipFirstRow) state.headers = record
        if (options?.columns) state.headers = options.columns
        if (options?.skipFirstRow) continue
        if (state.fieldsPerRecord === "UNINITIALIZED") state.fieldsPerRecord = record.length
      }
      if (typeof state.fieldsPerRecord === "number" && record.length !== state.fieldsPerRecord) {
        return yield* parseError(
          new SyntaxError(
            `Syntax error on line ${state.lineIndex + 1}: expected ${state.fieldsPerRecord} fields but got ${record.length}`,
          ),
        )
      }
      state.lineIndex++
      if (record.length === 0) continue
      if (named) {
        out.push(yield* Effect.try({
          try: () => convertRowToObject(record, state.headers, state.lineIndex) as RowType<T>,
          catch: parseError,
        }))
      } else {
        out.push(record as RowType<T>)
      }
    }
    return [state, out] as const
  })

  return self.pipe(
    lines,
    Stream.mapAccumEffect((): ParserState => ({
      pending: [],
      lineIndex: 0,
      first: true,
      headers: [],
      fieldsPerRecord: options?.fieldsPerRecord === undefined || options.fieldsPerRecord < 0
        ? "ANY"
        : options.fieldsPerRecord === 0
        ? "UNINITIALIZED"
        : options.fieldsPerRecord,
    }), step),
  )
}

/** Options for {@linkcode stringifyStream}. */
export interface StringifyStreamOptions {
  /** Character which separates values. @default {","} */
  readonly separator?: string | undefined
  /**
   * The columns to write, and a header row naming them. Without columns,
   * array rows are written as they are, and object rows take their columns
   * from the keys of the first row.
   */
  readonly columns?: ReadonlyArray<Column> | undefined
  /** Write a header row when columns are known. @default {true} */
  readonly headers?: boolean | undefined
}

/**
 * Stringifies a stream of rows (arrays or objects) into a stream of CSV
 * lines, one string per row with a CRLF line ending, preceded by a header
 * row when columns are known.
 */
export const stringifyStream = (options?: StringifyStreamOptions) =>
<E, R>(self: Stream.Stream<DataItem, E, R>): Stream.Stream<string, E | CsvError, R> =>
  self.pipe(
    Stream.mapAccumEffect(
      () => ({ columns: options?.columns, started: false }),
      (state, row: DataItem) =>
        Effect.try({
          try: () => {
            const out: Array<string> = []
            if (!state.started) {
              state.started = true
              if (state.columns === undefined && !Array.isArray(row)) state.columns = Object.keys(row)
              if (options?.headers !== false && state.columns !== undefined && state.columns.length > 0) {
                out.push(stdStringify([], { separator: options?.separator ?? ",", columns: state.columns }))
              }
            }
            out.push(
              stdStringify([row], { separator: options?.separator ?? ",", columns: state.columns ?? [], headers: false }),
            )
            return [state, out] as const
          },
          catch: stringifyError,
        }),
    ),
  )

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/** Options for {@linkcode schema} and {@linkcode decodeStream}. */
export interface SchemaOptions {
  /** Character which separates values. @default {","} */
  readonly separator?: string | undefined
  /** Character that starts a comment line. */
  readonly comment?: string | undefined
  /** Trim leading whitespace of each field. @default {false} */
  readonly trimLeadingSpace?: boolean | undefined
  /** Allow bare quotes. */
  readonly lazyQuotes?: boolean | undefined
}

const issue = (error: unknown, input: unknown) => new SchemaIssue.InvalidValue({ message: messageOf(error) }, input)

/**
 * A transformation between CSV text with a header row and the array of
 * records it holds.
 */
export const transformation = (
  options?: SchemaOptions,
): SchemaTransformation.Transformation<ReadonlyArray<unknown>, string> =>
  new SchemaTransformation.Transformation(
    SchemaGetter.transformEffect((text: string) =>
      Effect.try({
        try: (): ReadonlyArray<unknown> => stdParse(text, { ...(options as ParseOptions), skipFirstRow: true }),
        catch: (e) => issue(e, text),
      })
    ),
    SchemaGetter.transformEffect((rows: ReadonlyArray<unknown>) =>
      Effect.try({
        try: () => stdStringify(rows as ReadonlyArray<DataItem>, { separator: options?.separator ?? "," }),
        catch: (e) => issue(e, rows),
      })
    ),
  )

/**
 * A Schema that decodes CSV text with a header row into `Array<S>` and
 * encodes it back. Each record has string fields keyed by the header, so
 * `S` uses string codecs such as `Schema.FiniteFromString` for other types.
 *
 * ```ts
 * import { Schema } from "effect"
 * import * as Csv from "@mikepage/flareosaur/csv"
 *
 * const decode = Schema.decodeUnknownSync(Csv.schema(Schema.Struct({ id: Schema.FiniteFromString })))
 * decode("id\n1\n2\n") // [{ id: 1 }, { id: 2 }]
 * ```
 */
export const schema = <S extends Schema.Top>(target: S, options?: SchemaOptions) =>
  Schema.String.pipe(Schema.decodeTo(Schema.Array(target), transformation(options)))

/**
 * Parses a stream of CSV text chunks with a header row and decodes each
 * record with `S`, failing with a `SchemaError` on the first record that
 * does not match.
 */
export const decodeStream = <S extends Schema.Top>(target: S, options?: SchemaOptions) => {
  const decode = Schema.decodeUnknownEffect(target)
  return <E, R>(
    self: Stream.Stream<string, E, R>,
  ): Stream.Stream<S["Type"], E | CsvError | Schema.SchemaError, R | S["DecodingServices"]> =>
    self.pipe(parseStream({ ...options, skipFirstRow: true }), Stream.mapEffect((record) => decode(record)))
}
