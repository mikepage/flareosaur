// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * HTTP Message Signatures (RFC 9421): sign chosen components of a request
 * or response (method, path, headers, ...) with Web Crypto, and verify the
 * `Signature-Input` / `Signature` headers on the way in.
 *
 * Effect has no message signatures. This module runs std's
 * `unstable_message_signatures` as Effects: failures are a typed
 * {@linkcode MessageSignatureError}, the verification key lookup is an
 * Effect returning an `Option`, and there are bridges for Effect's HTTP
 * types: {@linkcode signClientRequest} signs an `HttpClientRequest` before
 * it is sent, and {@linkcode verifyRequest} verifies the current
 * `HttpServerRequest` in a route handler.
 *
 * Supported algorithms: `ed25519`, `ecdsa-p256-sha256`, `ecdsa-p384-sha384`,
 * `rsa-pss-sha512`, `rsa-v1_5-sha256` and `hmac-sha256`.
 *
 * ```ts
 * import { Effect, Option } from "effect"
 * import { HttpClientRequest } from "effect/http"
 * import * as MessageSignatures from "@mikepage/flareosaur/http/message-signatures"
 *
 * declare const privateKey: CryptoKey
 * declare const publicKey: CryptoKey
 *
 * const signed = MessageSignatures.signClientRequest(
 *   HttpClientRequest.post("https://example.com/api"),
 *   { key: privateKey, params: { components: ["@method", "@authority", "@path"], keyId: "k1" } },
 * )
 *
 * // server side, inside a route handler
 * const verified = MessageSignatures.verifyRequest((keyId) =>
 *   Effect.succeed(keyId === "k1" ? Option.some(publicKey) : Option.none())
 * )
 * ```
 *
 * @module
 */

import { type Cause, Duration, Effect, Option, Result, Schema } from "effect"
import { HttpClientRequest, HttpServerRequest } from "effect/http"
import {
  type ComponentIdentifier,
  type ComponentInput,
  type ComponentParameters,
  createSignatureBase,
  type DerivedComponent,
  type ParsedSignatureParams,
  type SignatureAlgorithm,
  type SignatureParams,
  signMessage,
  verifyMessage,
  type VerifyResult,
} from "./_std/unstable_message_signatures.ts"
import { isInnerList, parseDictionary } from "./_std/unstable_structured_fields.ts"
import { message } from "./_internal.ts"

export type {
  ComponentIdentifier,
  ComponentInput,
  ComponentParameters,
  DerivedComponent,
  ParsedSignatureParams,
  SignatureAlgorithm,
  SignatureParams,
  VerifyResult,
}

const MessageSignatureErrorBase: Schema.Class<
  MessageSignatureError,
  Schema.TaggedStruct<"MessageSignatureError", {
    readonly message: Schema.String
    readonly cause: Schema.Defect
  }>,
  Cause.YieldableError
> = Schema.TaggedError<MessageSignatureError>()("MessageSignatureError", {
  message: Schema.String,
  cause: Schema.Defect(),
})

/** Signing or verifying failed: bad parameters, missing or malformed headers, an unknown key, an expired or invalid signature. */
export class MessageSignatureError extends MessageSignatureErrorBase {}

const fail = (cause: unknown) => new MessageSignatureError({ message: message(cause), cause })

/** Options for signing. */
export interface SignOptions {
  /** The covered components and signature parameters. */
  readonly params: SignatureParams
  /** The private (or HMAC) key. The algorithm is inferred from it unless `params.algorithm` is set. */
  readonly key: CryptoKey
  /** The request a signed response answers, for `;req` components. */
  readonly request?: Request | undefined
}

/** Options for verifying. */
export interface VerifyOptions {
  /** Reject signatures whose `created` is older than this. */
  readonly maxAge?: Duration.Input | undefined
  /** Components every verified signature must cover. */
  readonly requiredComponents?: ReadonlyArray<ComponentInput> | undefined
  /** Verify only these signature labels (default: all). */
  readonly labels?: ReadonlyArray<string> | undefined
  /** The request a signed response answers, for `;req` components. */
  readonly request?: Request | undefined
}

/**
 * Finds the verification key for a `keyid` (and the `alg` parameter, when
 * the signature has one). `None` fails verification.
 */
export type KeyLookup<E = never, R = never> = (
  keyId: string,
  algorithm: Option.Option<SignatureAlgorithm>,
) => Effect.Effect<Option.Option<CryptoKey>, E, R>

/**
 * The signature base (RFC 9421 §2.5) of a message: the text that is signed.
 * Useful for debugging interoperability.
 */
export const signatureBase = (
  message: Request | Response,
  params: SignatureParams,
  request?: Request,
): Result.Result<string, MessageSignatureError> => {
  try {
    return Result.succeed(createSignatureBase({ message, params, ...(request ? { request } : {}) }))
  } catch (cause) {
    return Result.fail(fail(cause))
  }
}

/** Signs a web `Request` or `Response`, returning a copy with `Signature-Input` and `Signature` headers. */
export const sign = <T extends Request | Response>(
  message: T,
  options: SignOptions,
): Effect.Effect<T, MessageSignatureError> =>
  Effect.tryPromise({
    try: () =>
      signMessage({
        message,
        params: options.params,
        key: options.key,
        ...(options.request ? { request: options.request } : {}),
      }),
    catch: fail,
  })

/** The `(keyid, alg)` pairs a message's `Signature-Input` refers to. */
const keyRefs = (message: Request | Response, labels: ReadonlyArray<string> | undefined) => {
  const header = message.headers.get("Signature-Input")
  if (header === null) return []
  let dict
  try {
    dict = parseDictionary(header)
  } catch {
    return []
  }
  const refs = new Map<string, Option.Option<SignatureAlgorithm>>()
  for (const [label, member] of dict) {
    if (labels && !labels.includes(label)) continue
    if (!isInnerList(member)) continue
    const keyId = member.parameters.get("keyid")
    const alg = member.parameters.get("alg")
    refs.set(
      keyId?.type === "string" ? keyId.value : "",
      alg?.type === "string" ? Option.some(alg.value as SignatureAlgorithm) : Option.none(),
    )
  }
  return [...refs]
}

/**
 * Verifies every signature on a web `Request` or `Response` (or the
 * `labels` chosen), looking keys up with `keyLookup`. Succeeds with the
 * verified labels and their parameters; any failure fails the whole
 * verification.
 */
export const verify: <E, R>(
  message: Response | Request,
  keyLookup: KeyLookup<E, R>,
  options?: VerifyOptions,
) => Effect.Effect<ReadonlyArray<VerifyResult>, MessageSignatureError | E, R> = Effect.fnUntraced(function*<E, R>(
  message: Request | Response,
  keyLookup: KeyLookup<E, R>,
  options?: VerifyOptions,
) {
  const keys = new Map<string, CryptoKey>()
  for (const [keyId, alg] of keyRefs(message, options?.labels)) {
    const key = yield* keyLookup(keyId, alg)
    if (Option.isSome(key)) keys.set(keyId, key.value)
  }
  const maxAge = options?.maxAge === undefined ? undefined : Duration.fromInputUnsafe(options.maxAge)
  return yield* Effect.tryPromise({
    try: (): Promise<ReadonlyArray<VerifyResult>> =>
      verifyMessage(message, (keyId) => keys.get(keyId) ?? null, {
        ...(maxAge !== undefined ? { maxAge: Math.floor(Duration.toSeconds(maxAge)) } : {}),
        ...(options?.requiredComponents ? { requiredComponents: [...options.requiredComponents] } : {}),
        ...(options?.labels ? { labels: [...options.labels] } : {}),
        ...(options?.request ? { request: options.request } : {}),
      }),
    catch: fail,
  })
})

/**
 * Signs an `HttpClientRequest`: computes the signature over its method,
 * URL and headers and adds the `Signature-Input` and `Signature` headers.
 * The body is not part of the signature; cover a `Content-Digest` header to
 * protect it.
 */
export const signClientRequest: (
  request: HttpClientRequest.HttpClientRequest,
  options: SignOptions,
) => Effect.Effect<HttpClientRequest.HttpClientRequest, MessageSignatureError> = Effect.fnUntraced(function*(
  request: HttpClientRequest.HttpClientRequest,
  options: SignOptions,
) {
  const web = yield* Effect.fromResult(HttpClientRequest.toWebResult(request)).pipe(Effect.mapError(fail))
  const signed = yield* sign(new Request(web.url, { method: web.method, headers: web.headers }), options)
  return HttpClientRequest.setHeaders(request, {
    "signature-input": signed.headers.get("Signature-Input") ?? "",
    "signature": signed.headers.get("Signature") ?? "",
  })
})

/** Verifies the signatures of the current `HttpServerRequest` (see {@linkcode verify}). */
export const verifyRequest = <E, R>(
  keyLookup: KeyLookup<E, R>,
  options?: VerifyOptions,
): Effect.Effect<ReadonlyArray<VerifyResult>, MessageSignatureError | E, R | HttpServerRequest.HttpServerRequest> =>
  Effect.flatMap(Effect.service(HttpServerRequest.HttpServerRequest), (request) =>
    Effect.flatMap(
      Effect.fromResult(HttpServerRequest.toWebResult(request)).pipe(Effect.mapError(fail)),
      (web) => verify(new Request(web.url, { method: web.method, headers: web.headers }), keyLookup, options),
    ))
