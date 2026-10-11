/**
 * @title Phone number validator
 * @difficulty beginner
 * @tags workers, http, schema, npm
 * @group Web
 * @resource {https://gitlab.com/catamphetamine/libphonenumber-js} libphonenumber-js
 * @resource {https://effect.website/docs/schema/introduction/} Effect: Schema
 * @check GET / -> 200 "intl-tel-validate" "/api?number="
 * @check GET /api?number=%2B31612345678 -> 200 "\"valid\":true" "\"country\":\"NL\"" "\"numberType\":\"Mobile\"" "\"e164\":\"+31612345678\"" "+31 6 12345678"
 * @check GET /api?number=0201234567&country=nl&type=mobile -> 200 "\"valid\":false" "Expected mobile number, got Fixed line" "\"national\":\"020 123 4567\""
 * @check GET /api?number=%2B316abc&strict=1 -> 200 "\"valid\":false" "\"error\":\"Not a number\""
 * @check GET /api?number=%2B3161 -> 200 "\"valid\":false" "Number too short"
 * @check GET /api?number=%2B31612345678&type=fixed_line -> 200 "\"valid\":false" "Expected fixed line number, got Mobile"
 * @check GET /api -> 400 "\"error\""
 * @check GET /api?number=0612345678&country=ZZ -> 400 "Unknown country ZZ"
 * @check GET /api?number=0612345678&type=pager -> 400 "\"error\""
 *
 * Validates an international phone number: is it valid, which country and
 * type (mobile, fixed line, ...) is it, and what are its national,
 * international and E.164 formats. An npm library (libphonenumber-js, with
 * its full metadata) bundles straight into the Worker without
 * `nodejs_compat`; Schema validates the query before the library sees it.
 */

import { Effect, Layer, Schema, SchemaIssue, SchemaTransformation } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import * as Worker from "@mikepage/flareosaur/workers/worker"
import {
  type CountryCode,
  getCountries,
  parsePhoneNumberFromString,
  validatePhoneNumberLength,
} from "libphonenumber-js/max"

// libphonenumber's number types, as people read them.
const TYPE_LABELS: Record<string, string> = {
  FIXED_LINE: "Fixed line",
  MOBILE: "Mobile",
  FIXED_LINE_OR_MOBILE: "Fixed line or mobile",
  TOLL_FREE: "Toll free",
  PREMIUM_RATE: "Premium rate",
  SHARED_COST: "Shared cost",
  VOIP: "VoIP",
  PERSONAL_NUMBER: "Personal number",
  PAGER: "Pager",
  UAN: "UAN",
  VOICEMAIL: "Voicemail",
}

// Why a number that does not parse is invalid.
const LENGTH_ERRORS: Record<string, string> = {
  INVALID_COUNTRY: "Invalid country code",
  TOO_SHORT: "Number too short",
  TOO_LONG: "Number too long",
  NOT_A_NUMBER: "Not a number",
  INVALID_LENGTH: "Invalid length",
}

const COUNTRIES = new Set<string>(getCountries())
const regionName = new Intl.DisplayNames(["en"], { type: "region" })
const nameOf = (cc: string) => regionName.of(cc) ?? cc

// The query. `country` is uppercased while decoding and checked against
// libphonenumber's own list; `strict` accepts the values an HTML checkbox
// or a script would send.
const Query = Schema.Struct({
  number: Schema.Trim.check(Schema.isNonEmpty({ message: "Please enter a phone number" })),
  country: Schema.optional(
    Schema.Trim.pipe(
      Schema.decodeTo(Schema.String, SchemaTransformation.toUpperCase()),
      Schema.check(Schema.makeFilter((cc: string) => cc === "" || COUNTRIES.has(cc) || `Unknown country ${cc}`)),
    ),
  ),
  strict: Schema.optional(Schema.String),
  type: Schema.optional(Schema.Literals(["any", "mobile", "fixed_line"])),
})

interface Result {
  valid: boolean
  error?: string
  country?: string
  countryName?: string
  numberType?: string
  national?: string
  international?: string
  e164?: string
}

// The validation itself is synchronous and cannot fail: an invalid number
// is a result (`valid: false`), not an error.
const validate = (
  number: string,
  country: CountryCode | undefined,
  strict: boolean,
  type: "any" | "mobile" | "fixed_line",
): Result => {
  // Strict mode mirrors intl-tel-input's: only characters a phone number can contain.
  if (strict && !/^\+?[\d\s().-]+$/.test(number)) return { valid: false, error: "Not a number" }
  const phone = parsePhoneNumberFromString(number, country)
  if (!phone || !phone.isValid()) {
    const reason = validatePhoneNumberLength(number, country)
    const cc = phone?.country ?? country
    return {
      valid: false,
      error: (reason && LENGTH_ERRORS[reason]) || "Invalid number",
      ...(cc ? { country: cc, countryName: nameOf(cc) } : {}),
    }
  }
  const raw = phone.getType()
  const label = (raw && TYPE_LABELS[raw]) || "Unknown"
  const result: Result = {
    valid: true,
    ...(phone.country ? { country: phone.country, countryName: nameOf(phone.country) } : {}),
    numberType: label,
    national: phone.formatNational(),
    international: phone.formatInternational(),
    e164: phone.number,
  }
  const mobile = raw === "MOBILE" || raw === "FIXED_LINE_OR_MOBILE"
  const fixed = raw === "FIXED_LINE" || raw === "FIXED_LINE_OR_MOBILE"
  if (type === "mobile" && !mobile) return { ...result, valid: false, error: `Expected mobile number, got ${label}` }
  if (type === "fixed_line" && !fixed) return { ...result, valid: false, error: `Expected fixed line number, got ${label}` }
  return result
}

const api = Effect.gen(function*() {
  const query = yield* HttpServerRequest.schemaSearchParams(Query)
  const country = query.country ? query.country as CountryCode : undefined
  const strict = query.strict === "1" || query.strict === "on" || query.strict === "true"
  return HttpServerResponse.jsonUnsafe(validate(query.number, country, strict, query.type ?? "any"))
}).pipe(
  // A query that does not decode is the caller's mistake: 400, with the
  // Schema's own explanation.
  Effect.catchTag("SchemaError", (error) =>
    Effect.succeed(
      HttpServerResponse.jsonUnsafe({ error: SchemaIssue.makeFormatterDefault()(error.issue) }, { status: 400 }),
    )),
)

const describe = HttpServerResponse.jsonUnsafe({
  name: "intl-tel-validate",
  description:
    "Validate an international phone number with libphonenumber: validity, country, number type and the national, international and E.164 formats.",
  params: {
    number: "Phone number, ideally with +country code, e.g. +31 6 12345678 (required)",
    country: "ISO 3166 alpha-2 country for numbers without a + prefix, e.g. NL",
    strict: "1 = reject input with anything but digits, spaces and + - . ( )",
    type: "any (default), mobile or fixed_line: the required number type",
  },
  example: "/api?number=%2B31612345678",
})

const routes = Layer.mergeAll(
  HttpRouter.add("GET", "/", describe),
  HttpRouter.add("GET", "/api", api),
)

export default Worker.make({ fetch: routes })
