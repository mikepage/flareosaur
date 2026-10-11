// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * Structured Field Values for HTTP (RFC 9651, which obsoletes RFC 8941):
 * parse and serialize Lists, Dictionaries and Items with strict RFC rules.
 *
 * Effect has no structured field support. This module wraps std's
 * `unstable_structured_fields`: parsers and serializers return a `Result`
 * that fails with a {@linkcode StructuredFieldError} instead of throwing,
 * the data model has Schemas ({@linkcode Item}, {@linkcode List},
 * {@linkcode Dictionary}, ...), and {@linkcode ItemFromString},
 * {@linkcode ListFromString} and {@linkcode DictionaryFromString} are Schema
 * codecs between header values and the model. std's builders
 * ({@linkcode integer}, {@linkcode string}, {@linkcode item}, ...) and
 * guards are re-exported.
 *
 * ```ts
 * import { Result } from "effect"
 * import * as SF from "@mikepage/flareosaur/http/structured-fields"
 *
 * const dict = Result.getOrThrow(SF.parseDictionary("a=1, b;x=?0, c=(x y)"))
 * dict.get("a") // { value: { type: "integer", value: 1 }, parameters: Map {} }
 *
 * Result.getOrThrow(SF.serializeItem(SF.item(SF.token("gzip"), [["q", SF.decimal(0.5)]])))
 * // "gzip;q=0.5"
 * ```
 *
 * @module
 */

import { Result, Schema } from "effect"
import * as std from "./_std/unstable_structured_fields.ts"
import { fromResults, message } from "./_internal.ts"

export {
  /** Builds a binary (byte sequence) bare item. */
  binary,
  /** Builds a boolean bare item. */
  boolean,
  /** Builds a date bare item (whole seconds). */
  date,
  /** Builds a decimal bare item. */
  decimal,
  /** Builds a display string bare item (RFC 9651). */
  displayString,
  /** Builds an inner list from items and optional parameters. */
  innerList,
  /** Builds an integer bare item. */
  integer,
  /** Whether a list member is an inner list. */
  isInnerList,
  /** Whether a list member is an item. */
  isItem,
  /** Builds an item from a bare item and optional parameters. */
  item,
  /** Builds a string bare item. */
  string,
  /** Builds a token bare item. */
  token,
} from "./_std/unstable_structured_fields.ts"

/** A structured field could not be parsed or serialized. */
export class StructuredFieldError extends Schema.TaggedError<StructuredFieldError>()("StructuredFieldError", {
  kind: Schema.Literals(["Parse", "Serialize"]),
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

const bare = <T extends string, S extends Schema.Top>(type: T, value: S) =>
  Schema.Struct({ type: Schema.Literal(type), value })

/** A Schema for bare items: the values an item or parameter can hold. */
export const BareItem = Schema.Union([
  bare("integer", Schema.Number),
  bare("decimal", Schema.Number),
  bare("string", Schema.String),
  bare("token", Schema.String),
  bare("binary", Schema.Uint8Array),
  bare("boolean", Schema.Boolean),
  bare("date", Schema.Date),
  bare("displaystring", Schema.String),
])

/** A bare item: the value of an item or a parameter. */
export type BareItem = std.BareItem

/** A Schema for the parameters attached to an item or inner list. */
export const Parameters = Schema.ReadonlyMap(Schema.String, BareItem)

/** Parameters attached to an item or inner list. */
export type Parameters = std.Parameters

/** A Schema for an item: a bare item with parameters. */
export const Item = Schema.Struct({ value: BareItem, parameters: Parameters })

/** An item: a bare item with parameters. */
export type Item = std.Item

/** A Schema for an inner list: items with parameters of their own. */
export const InnerList = Schema.Struct({ items: Schema.Array(Item), parameters: Parameters })

/** An inner list: items with parameters of their own. */
export type InnerList = std.InnerList

/** A Schema for a member of a list or dictionary. */
export const Member = Schema.Union([Item, InnerList])

/** A member of a list or dictionary. */
export type Member = Item | InnerList

/** A Schema for a top-level list. */
export const List = Schema.Array(Member)

/** A top-level list. */
export type List = std.List

/** A Schema for a top-level dictionary. */
export const Dictionary = Schema.ReadonlyMap(Schema.String, Member)

/** A top-level dictionary, in field order. */
export type Dictionary = std.Dictionary

const attempt = <A>(kind: "Parse" | "Serialize", f: () => A): Result.Result<A, StructuredFieldError> => {
  try {
    return Result.succeed(f())
  } catch (cause) {
    return Result.fail(new StructuredFieldError({ kind, message: message(cause), cause }))
  }
}

/** Parses a field value as an Item. */
export const parseItem = (input: string): Result.Result<Item, StructuredFieldError> =>
  attempt("Parse", () => std.parseItem(input))

/** Parses a field value as a List. */
export const parseList = (input: string): Result.Result<List, StructuredFieldError> =>
  attempt("Parse", () => std.parseList(input))

/** Parses a field value as a Dictionary. */
export const parseDictionary = (input: string): Result.Result<Dictionary, StructuredFieldError> =>
  attempt("Parse", () => std.parseDictionary(input))

/** Serializes an Item. Fails on values the RFC cannot represent. */
export const serializeItem = (value: Item): Result.Result<string, StructuredFieldError> =>
  attempt("Serialize", () => std.serializeItem(value))

/** Serializes a List. Fails on values the RFC cannot represent. */
export const serializeList = (value: List): Result.Result<string, StructuredFieldError> =>
  attempt("Serialize", () => std.serializeList(value))

/** Serializes a Dictionary. Fails on values the RFC cannot represent. */
export const serializeDictionary = (value: Dictionary): Result.Result<string, StructuredFieldError> =>
  attempt("Serialize", () => std.serializeDictionary(value))

const typed = <T>(schema: Schema.Codec<unknown>) => schema as unknown as Schema.Codec<T>

/** A Schema between a field value and an {@linkcode Item}. */
export const ItemFromString: Schema.Codec<Item, string> = Schema.String.pipe(
  Schema.decodeTo(typed<Item>(Item), fromResults(parseItem, serializeItem)),
)

/** A Schema between a field value and a {@linkcode List}. */
export const ListFromString: Schema.Codec<List, string> = Schema.String.pipe(
  Schema.decodeTo(typed<List>(List), fromResults(parseList, serializeList)),
)

/** A Schema between a field value and a {@linkcode Dictionary}. */
export const DictionaryFromString: Schema.Codec<Dictionary, string> = Schema.String.pipe(
  Schema.decodeTo(typed<Dictionary>(Dictionary), fromResults(parseDictionary, serializeDictionary)),
)
