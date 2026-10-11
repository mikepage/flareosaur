// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * HTTP status codes: std's {@linkcode STATUS_CODE} and {@linkcode STATUS_TEXT}
 * tables, type guards for each status class, and a {@linkcode StatusCode}
 * Schema.
 *
 * `effect/http/HttpStatus` offers `HttpStatus.fromLiteral("NotFound")`
 * (names to numbers). This module keeps std's tables (numbers to reason
 * phrases, and the `ClientErrorStatus`-style literal unions), adds an
 * `Option`-returning {@linkcode statusText} and Schemas for validating codes.
 *
 * ```ts
 * import { Option, Schema } from "effect"
 * import * as Status from "@mikepage/flareosaur/http/status"
 *
 * Status.STATUS_CODE.NotFound // 404
 * Status.statusText(404) // Option.some("Not Found")
 * Status.isClientErrorStatus(404) // true
 * Schema.is(Status.StatusCode)(404) // true
 * ```
 *
 * @module
 */

import { Option, Schema } from "effect"
import {
  type ClientErrorStatus,
  type ErrorStatus as StdErrorStatus,
  type InformationalStatus,
  isClientErrorStatus,
  isErrorStatus,
  isInformationalStatus,
  isRedirectStatus,
  isServerErrorStatus,
  isStatus,
  isSuccessfulStatus,
  type RedirectStatus,
  type ServerErrorStatus,
  STATUS_CODE,
  STATUS_TEXT,
  type StatusCode as StdStatusCode,
  type StatusText,
  type SuccessfulStatus,
} from "./_std/status.ts"

export {
  /** Whether the status is a client error (4XX). */
  isClientErrorStatus,
  /** Whether the status is a client or server error (4XX or 5XX). */
  isErrorStatus,
  /** Whether the status is informational (1XX). */
  isInformationalStatus,
  /** Whether the status is a redirect (3XX). */
  isRedirectStatus,
  /** Whether the status is a server error (5XX). */
  isServerErrorStatus,
  /** Whether the number is a known status code. */
  isStatus,
  /** Whether the status is a success (2XX). */
  isSuccessfulStatus,
  /** Standard HTTP status codes by name. */
  STATUS_CODE,
  /** Standard reason phrases by status code. */
  STATUS_TEXT,
}

export type {
  ClientErrorStatus,
  InformationalStatus,
  RedirectStatus,
  ServerErrorStatus,
  StatusText,
  SuccessfulStatus,
}

/** An error status code (4XX or 5XX). */
export type ErrorStatus = StdErrorStatus

/** A known HTTP status code. */
export type StatusCode = StdStatusCode

/** A Schema for the known HTTP status codes. */
export const StatusCode: Schema.Literals<ReadonlyArray<StatusCode>> = Schema.Literals(
  Object.values(STATUS_CODE) as ReadonlyArray<StatusCode>,
)

/** A Schema for the error status codes (4XX and 5XX). */
export const ErrorStatus: Schema.Literals<ReadonlyArray<ErrorStatus>> = Schema.Literals(
  Object.values(STATUS_CODE).filter(isErrorStatus),
)

/**
 * Returns the reason phrase of a status code.
 *
 * ```ts
 * import { statusText } from "@mikepage/flareosaur/http/status"
 *
 * statusText(418) // Option.some("I'm a teapot")
 * statusText(299) // Option.none()
 * ```
 */
export const statusText = (status: number): Option.Option<StatusText> =>
  isStatus(status) ? Option.some(STATUS_TEXT[status]) : Option.none()
