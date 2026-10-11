// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * Escaping for HTML, CSS and inline JavaScript, custom element names, and
 * `html` template tags.
 *
 * Effect has no HTML helpers. This module is `@std/html` with Effect types
 * where they fit: {@linkcode unescape} is pipeable (`Function.dual`),
 * {@linkcode escapeJs} returns a `Result` instead of throwing on values JSON
 * cannot hold, {@linkcode CustomElementName} is a branded Schema, and
 * {@linkcode StringFromHtml} is a Schema codec between escaped HTML text and
 * plain text.
 *
 * ```ts
 * import { Schema } from "effect"
 * import * as Html from "@mikepage/flareosaur/html"
 *
 * Html.escape("<p>Tom & Jerry</p>") // "&lt;p&gt;Tom &amp; Jerry&lt;/p&gt;"
 * Html.unescape("&lt;p&gt;") // "<p>"
 * Html.safeHtml`<p>${"<b>"}</p>` // "<p>&lt;b&gt;</p>"
 *
 * const name = Schema.decodeUnknownSync(Html.CustomElementName)("my-element")
 * ```
 *
 * @module
 */

import { type Cause, Function, Predicate, Result, Schema, type SchemaAST, SchemaTransformation } from "effect"
import { escape as stdEscape, type EntityList, unescape as stdUnescape } from "./_std/entities.ts"
import { escapeCss as stdEscapeCss } from "./_std/unstable_escape_css.ts"
import { escapeJs as stdEscapeJs, type EscapeJsOptions } from "./_std/unstable_escape_js.ts"
import { isValidCustomElementName as stdIsValidCustomElementName } from "./_std/unstable_is_valid_custom_element_name.ts"

export type { EntityList, EscapeJsOptions }

/** Options for {@linkcode unescape}. */
export interface UnescapeOptions {
  /**
   * The named entities to replace, mapping `&name;` to its text. Defaults to
   * the entities {@linkcode escape} produces plus `&apos;` and `&nbsp;`.
   */
  readonly entityList?: EntityList | undefined
}

/**
 * Escapes the characters HTML treats specially (`&`, `<`, `>`, `"`, `'`) as
 * entities. Other characters are left alone.
 *
 * ```ts
 * import * as Html from "@mikepage/flareosaur/html"
 *
 * Html.escape("<>'&AA") // "&lt;&gt;&#39;&amp;AA"
 * ```
 */
export const escape = (text: string): string => stdEscape(text)

/**
 * Replaces HTML entities with the characters they stand for: the named
 * entities in `entityList`, and every decimal (`&#46;`) and hexadecimal
 * (`&#x2e;`) character reference. Data-first or data-last.
 *
 * ```ts
 * import { pipe } from "effect"
 * import * as Html from "@mikepage/flareosaur/html"
 *
 * Html.unescape("&lt;&gt;&#39;&amp;AA") // "<>'&AA"
 * pipe("&thorn;", Html.unescape({ entityList: { "&thorn;": "þ" } })) // "þ"
 * ```
 */
export const unescape: {
  (options?: UnescapeOptions): (text: string) => string
  (text: string, options?: UnescapeOptions): string
} = Function.dual(
  (args) => Predicate.isString(args[0]),
  (text: string, options?: UnescapeOptions): string =>
    stdUnescape(text, options?.entityList ? { entityList: options.entityList } : {}),
)

/**
 * A Schema codec between HTML-escaped text (encoded) and plain text (type):
 * decoding unescapes, encoding escapes.
 *
 * ```ts
 * import { Schema } from "effect"
 * import * as Html from "@mikepage/flareosaur/html"
 *
 * Schema.decodeSync(Html.StringFromHtml)("a &lt; b") // "a < b"
 * Schema.encodeSync(Html.StringFromHtml)("a < b") // "a &lt; b"
 * ```
 */
export const StringFromHtml: Schema.decodeTo<Schema.String, Schema.String> = Schema.String.pipe(
  Schema.decodeTo(
    Schema.String,
    SchemaTransformation.transform({ decode: (text: string) => unescape(text), encode: escape }),
  ),
)

/**
 * Escapes a string for use as a CSS identifier, like the browser's
 * `CSS.escape`.
 *
 * ```ts
 * import * as Html from "@mikepage/flareosaur/html"
 *
 * Html.escapeCss("1x") // "\\31 x"
 * ```
 */
export const escapeCss = (text: string): string => stdEscapeCss(text)

const EscapeJsErrorBase: Schema.Class<
  EscapeJsError,
  Schema.TaggedStruct<"EscapeJsError", {
    readonly message: Schema.String
    readonly cause: Schema.Defect
  }>,
  Cause.YieldableError
> = Schema.TaggedError<EscapeJsError>()("EscapeJsError", {
  message: Schema.String,
  cause: Schema.Defect(),
})

/** A value could not be serialized for a `<script>` element. */
export class EscapeJsError extends EscapeJsErrorBase {}

/**
 * Serializes a value as JSON that is safe to place inside a `<script>`
 * element: `<!--`, `<script` and `</script` are escaped, and so are U+2028
 * and U+2029. Fails for values JSON cannot represent (`undefined`,
 * functions, `BigInt`, cycles).
 *
 * ```ts
 * import { Result } from "effect"
 * import * as Html from "@mikepage/flareosaur/html"
 *
 * Html.escapeJs("</script>") // Result.succeed('"\\u003c/script>"')
 * Result.isFailure(Html.escapeJs(1n)) // true
 * ```
 */
export const escapeJs = (data: unknown, options?: EscapeJsOptions): Result.Result<string, EscapeJsError> => {
  try {
    if (JSON.stringify(data) === undefined) {
      return Result.fail(new EscapeJsError({ message: `Cannot serialize ${typeof data} as JSON`, cause: data }))
    }
    return Result.succeed(stdEscapeJs(data, options))
  } catch (cause) {
    return Result.fail(new EscapeJsError({ message: cause instanceof Error ? cause.message : String(cause), cause }))
  }
}

/**
 * Whether a string is a valid custom element name: lowercase, starts with
 * an ASCII letter, contains a hyphen, and is not one of the reserved names
 * such as `font-face`.
 *
 * ```ts
 * import * as Html from "@mikepage/flareosaur/html"
 *
 * Html.isValidCustomElementName("custom-element") // true
 * Html.isValidCustomElementName("font-face") // false
 * ```
 */
export const isValidCustomElementName = (name: string): boolean => stdIsValidCustomElementName(name)

/**
 * A Schema check that a string is a valid custom element name, for use with
 * `Schema.String.check(...)`.
 */
export const isCustomElementName = (annotations?: Schema.Annotations.Filter): SchemaAST.Filter<string> =>
  Schema.makeFilter<string>((name) => isValidCustomElementName(name), {
    expected: "a valid custom element name",
    ...annotations,
  })

/**
 * A string that is a valid custom element name, branded `CustomElementName`.
 *
 * ```ts
 * import { Schema } from "effect"
 * import * as Html from "@mikepage/flareosaur/html"
 *
 * Schema.is(Html.CustomElementName)("my-element") // true
 * Schema.is(Html.CustomElementName)("div") // false
 * ```
 */
export const CustomElementName: Schema.brand<Schema.String, "CustomElementName"> =
  Schema.String.check(isCustomElementName()).pipe(Schema.brand("CustomElementName"))

/** A valid custom element name. */
export type CustomElementName = typeof CustomElementName.Type

const interpolate = (strings: TemplateStringsArray, values: ReadonlyArray<unknown>, f: (value: unknown) => string) =>
  strings.reduce((result, str, i) => result + str + (i < values.length ? f(values[i]) : ""), "")

/**
 * A template tag that joins the template as is. It does not escape the
 * interpolated values; it exists so editors highlight the template as HTML.
 * `null` and `undefined` become empty strings. Use {@linkcode safeHtml} for
 * untrusted values.
 *
 * ```ts
 * import * as Html from "@mikepage/flareosaur/html"
 *
 * Html.html`<div>${"<b>hi</b>"}</div>` // "<div><b>hi</b></div>"
 * ```
 */
export const html = (strings: TemplateStringsArray, ...values: Array<unknown>): string =>
  interpolate(strings, values, (value) => Predicate.isNullish(value) ? "" : String(value))

/**
 * A template tag that escapes every interpolated value with
 * {@linkcode escape}. `null` and `undefined` become empty strings, and the
 * elements of an array are escaped and joined.
 *
 * ```ts
 * import * as Html from "@mikepage/flareosaur/html"
 *
 * Html.safeHtml`<div>${'<script>alert("x")</script>'}</div>`
 * // '<div>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</div>'
 * ```
 */
export const safeHtml = (strings: TemplateStringsArray, ...values: Array<unknown>): string => {
  const render = (value: unknown): string =>
    Predicate.isNullish(value) ? "" : Array.isArray(value) ? value.map(render).join("") : escape(String(value))
  return interpolate(strings, values, render)
}
