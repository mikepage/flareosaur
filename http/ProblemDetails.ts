// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * Problem Details for HTTP APIs (RFC 9457): the `application/problem+json`
 * error format, as a Schema, as responses, and as a typed error that turns
 * itself into a response.
 *
 * Effect has no problem details support. This module covers std's
 * `unstable_problem_details` and `unstable_error`:
 *
 * - {@linkcode ProblemDetails}: a Schema for the problem object (standard
 *   members plus extension members);
 * - {@linkcode response}: an `HttpServerResponse` for a problem, with the
 *   RFC's defaults (`type: "about:blank"`, `status: 500`, `title` from the
 *   status);
 * - {@linkcode Problem}: a `Schema.TaggedError` carrying a problem. It is
 *   `HttpServerRespondable`, so failing a route handler with it makes
 *   `HttpRouter` answer with the problem response; it replaces std's
 *   `HttpError`;
 * - {@linkcode catchProblems}: turn any failure of a handler into a problem
 *   response;
 * - {@linkcode parse}, {@linkcode isProblemResponse} and
 *   {@linkcode fromResponse}: read problems on the client side.
 *
 * ```ts
 * import { Effect } from "effect"
 * import { HttpRouter, HttpServerResponse } from "effect/http"
 * import * as ProblemDetails from "@mikepage/flareosaur/http/problem-details"
 *
 * const route = HttpRouter.add(
 *   "GET",
 *   "/items/:id",
 *   Effect.gen(function*() {
 *     return yield* new ProblemDetails.Problem({ status: 404, detail: "No such item" })
 *   }),
 * )
 * // GET /items/1 -> 404 application/problem+json
 * // {"status":404,"detail":"No such item","type":"about:blank","title":"Not Found"}
 * ```
 *
 * @module
 */

import { type Cause, Effect, Function, Option, Result, Schema } from "effect"
import { HttpClientResponse, HttpServerRespondable, HttpServerResponse } from "effect/http"
import { parseProblemDetails } from "./_std/unstable_problem_details.ts"
import { STATUS_TEXT } from "./_std/status.ts"
import { header, type HeadersInput, message } from "./_internal.ts"

/** The media type of problem details. */
export const MEDIA_TYPE = "application/problem+json"

const ProblemDetailsErrorBase: Schema.Class<
  ProblemDetailsError,
  Schema.TaggedStruct<"ProblemDetailsError", {
    readonly message: Schema.String
    readonly cause: Schema.Defect
  }>,
  Cause.YieldableError
> = Schema.TaggedError<ProblemDetailsError>()("ProblemDetailsError", {
  message: Schema.String,
  cause: Schema.Defect(),
})

/** A problem object could not be read or written. */
export class ProblemDetailsError extends ProblemDetailsErrorBase {}

const fail = (cause: unknown) => new ProblemDetailsError({ message: message(cause), cause })

/** The standard members of a problem object (RFC 9457 §3.1). */
export const ProblemDetailsMembers: Schema.Struct<{
  /** A URI reference identifying the problem type (default `about:blank`). */
  readonly type: Schema.optionalKey<Schema.String>
  /** The HTTP status code. */
  readonly status: Schema.optionalKey<Schema.Int>
  /** A short, human-readable summary of the problem type. */
  readonly title: Schema.optionalKey<Schema.String>
  /** A human-readable explanation of this occurrence. */
  readonly detail: Schema.optionalKey<Schema.String>
  /** A URI reference identifying this occurrence. */
  readonly instance: Schema.optionalKey<Schema.String>
}> = Schema.Struct({
  /** A URI reference identifying the problem type (default `about:blank`). */
  type: Schema.optionalKey(Schema.String),
  /** The HTTP status code. */
  status: Schema.optionalKey(Schema.Int),
  /** A short, human-readable summary of the problem type. */
  title: Schema.optionalKey(Schema.String),
  /** A human-readable explanation of this occurrence. */
  detail: Schema.optionalKey(Schema.String),
  /** A URI reference identifying this occurrence. */
  instance: Schema.optionalKey(Schema.String),
})

/** A problem object: the standard members plus any extension members. */
export const ProblemDetails: Schema.StructWithRest<
  typeof ProblemDetailsMembers,
  readonly [Schema.$Record<Schema.String, Schema.Unknown>]
> = Schema.StructWithRest(ProblemDetailsMembers, [Schema.Record(Schema.String, Schema.Unknown)])

/** A problem object: the standard members plus any extension members. */
export type ProblemDetails = typeof ProblemDetails.Type

/**
 * Reads a problem object from parsed JSON, leniently as RFC 9457 §3.1 asks:
 * standard members of the wrong type are dropped, extensions are kept.
 * Fails only when the input is not a JSON object.
 */
export const parse = (input: unknown): Result.Result<ProblemDetails, ProblemDetailsError> => {
  try {
    return Result.succeed(parseProblemDetails(input) as ProblemDetails)
  } catch (cause) {
    return Result.fail(fail(cause))
  }
}

/** Fills in the RFC's defaults: `type: "about:blank"`, `status: 500`, and the title of an `about:blank` problem. */
export const withDefaults = (problem: ProblemDetails): ProblemDetails => {
  const type = problem.type ?? "about:blank"
  const status = problem.status ?? 500
  const title = problem.title ?? (type === "about:blank" ? STATUS_TEXT[status as keyof typeof STATUS_TEXT] : undefined)
  return { ...problem, type, status, ...(title !== undefined ? { title } : {}) }
}

/** Options for {@linkcode response}. */
export interface ResponseOptions {
  readonly headers?: HttpServerResponse.Options["headers"]
  readonly statusText?: string | undefined
}

/**
 * An `application/problem+json` response for a problem, with defaults
 * filled in. Fails when the status is not an integer or a member cannot be
 * serialized as JSON.
 */
export const response = (
  problem: ProblemDetails,
  options?: ResponseOptions,
): Effect.Effect<HttpServerResponse.HttpServerResponse, ProblemDetailsError> => {
  const body = withDefaults(problem)
  if (!Number.isInteger(body.status)) {
    return Effect.fail(fail(new RangeError(`status must be an integer, received ${String(body.status)}`)))
  }
  return HttpServerResponse.json(body, {
    status: body.status!,
    contentType: MEDIA_TYPE,
    headers: options?.headers,
    statusText: options?.statusText,
  }).pipe(Effect.mapError(fail))
}

const ProblemBase: Schema.Class<
  Problem,
  Schema.TaggedStruct<"Problem", {
    readonly status: Schema.Int
    readonly extensions: Schema.optionalKey<Schema.$Record<Schema.String, Schema.Unknown>>
    /** A URI reference identifying the problem type (default `about:blank`). */
    readonly type: Schema.optionalKey<Schema.String>
    /** A short, human-readable summary of the problem type. */
    readonly title: Schema.optionalKey<Schema.String>
    /** A human-readable explanation of this occurrence. */
    readonly detail: Schema.optionalKey<Schema.String>
    /** A URI reference identifying this occurrence. */
    readonly instance: Schema.optionalKey<Schema.String>
  }>,
  Cause.YieldableError
> = Schema.TaggedError<Problem>()("Problem", {
  ...ProblemDetailsMembers.fields,
  status: Schema.Int,
  extensions: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
})

/**
 * A failure that is an HTTP problem. Fail a route handler with it and
 * `HttpRouter` answers with its problem response. Extension members go in
 * `extensions`.
 */
export class Problem extends ProblemBase implements HttpServerRespondable.Respondable {
  /** The problem object this error stands for. */
  get problem(): ProblemDetails {
    const out: Record<string, unknown> = { ...this.extensions }
    for (const key of ["type", "status", "title", "detail", "instance"] as const) {
      if (this[key] !== undefined) out[key] = this[key]
    }
    return out as ProblemDetails
  }

  /** The problem response (see {@linkcode response}). */
  [HttpServerRespondable.symbol](): Effect.Effect<HttpServerResponse.HttpServerResponse, ProblemDetailsError> {
    return response(this.problem)
  }
}

/**
 * Builds a {@linkcode Problem} from a status and an optional detail
 * (std's `new HttpError(status, message)`).
 */
export const problem = (status: number, detail?: string, extensions?: Record<string, unknown>): Problem =>
  new Problem({
    status,
    ...(detail !== undefined ? { detail } : {}),
    ...(extensions !== undefined ? { extensions } : {}),
  })

/**
 * Turns failures of a handler into problem responses: a {@linkcode Problem}
 * becomes its own response, any other failure goes through `onError`
 * (default: a bare `500` problem, without leaking the error).
 */
export const catchProblems: {
  <E>(onError?: (error: Exclude<E, Problem>) => Problem): <A extends HttpServerResponse.HttpServerResponse, R>(
    self: Effect.Effect<A, E, R>,
  ) => Effect.Effect<HttpServerResponse.HttpServerResponse, never, R>
  <A extends HttpServerResponse.HttpServerResponse, E, R>(
    self: Effect.Effect<A, E, R>,
    onError?: (error: Exclude<E, Problem>) => Problem,
  ): Effect.Effect<HttpServerResponse.HttpServerResponse, never, R>
} = Function.dual(
  (args) => Effect.isEffect(args[0]),
  <A extends HttpServerResponse.HttpServerResponse, E, R>(
    self: Effect.Effect<A, E, R>,
    onError?: (error: Exclude<E, Problem>) => Problem,
  ): Effect.Effect<HttpServerResponse.HttpServerResponse, never, R> =>
    Effect.catch(self, (error: E) => {
      const p = error instanceof Problem ? error : onError ? onError(error as Exclude<E, Problem>) : problem(500)
      return response(p.problem).pipe(
        Effect.catch(() => Effect.succeed(HttpServerResponse.empty({ status: 500 }))),
      )
    }),
)

/** Whether a message's `Content-Type` is `application/problem+json`. */
export const isProblemResponse = (input: HeadersInput): boolean =>
  Option.match(header(input, "content-type"), {
    onNone: () => false,
    onSome: (value) => value.split(";")[0]!.trim().toLowerCase() === MEDIA_TYPE,
  })

/**
 * Reads the problem from an `HttpClientResponse`. `None` when the response
 * is not `application/problem+json`.
 */
export const fromResponse = (
  self: HttpClientResponse.HttpClientResponse,
): Effect.Effect<Option.Option<ProblemDetails>, ProblemDetailsError> =>
  isProblemResponse(self)
    ? self.json.pipe(
      Effect.mapError(fail),
      Effect.flatMap((json) => Effect.fromResult(parse(json))),
      Effect.map(Option.some),
    )
    : Effect.succeedNone
