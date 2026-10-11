// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.

/**
 * Signed cookies: append an HMAC signature to a cookie value so the server
 * can detect tampering, and verify it when the cookie comes back.
 *
 * Effect's `Cookies` and `HttpServerResponse.setCookie` handle the cookie
 * itself; this module adds std's `unstable_signed_cookie` on top. The key
 * lives in the {@linkcode CookieSigner} service, built from a `Redacted`
 * secret with {@linkcode layer}, so it never shows up in logs.
 * {@linkcode setCookie} and {@linkcode getCookie} sign and verify cookies on
 * Effect HTTP responses and requests.
 *
 * The value is not encrypted: anyone can read it, but changing it
 * invalidates the signature.
 *
 * ```ts
 * import { Effect, Option, Redacted } from "effect"
 * import { HttpServerResponse } from "effect/http"
 * import * as SignedCookie from "@mikepage/flareosaur/http/signed-cookie"
 *
 * const login = HttpServerResponse.text("welcome").pipe(
 *   SignedCookie.setCookie("session", "user-42", { httpOnly: true, path: "/" }),
 * )
 *
 * const whoami = Effect.map(SignedCookie.getCookie("session"), Option.getOrElse(() => "anonymous"))
 *
 * const SignerLive = SignedCookie.layer(Redacted.make("a long random secret"))
 * ```
 *
 * @module
 */

import { type Cause, Context, Effect, Function, Layer, Option, Redacted, Schema } from "effect"
import { type Cookies, HttpServerRequest, HttpServerResponse } from "effect/http"
import { parseSignedCookie, signCookie, verifySignedCookie } from "./_std/unstable_signed_cookie.ts"
import { message } from "./_internal.ts"

const SignedCookieErrorBase: Schema.Class<
  SignedCookieError,
  Schema.TaggedStruct<"SignedCookieError", {
    readonly message: Schema.String
    readonly cause: Schema.Defect
  }>,
  Cause.YieldableError
> = Schema.TaggedError<SignedCookieError>()("SignedCookieError", {
  message: Schema.String,
  cause: Schema.Defect(),
})

/** Signing or verifying a cookie failed in Web Crypto (for example, an unusable key). */
export class SignedCookieError extends SignedCookieErrorBase {}

const fail = (cause: unknown) => new SignedCookieError({ message: message(cause), cause })

const CookieSignerBase: Context.ServiceClass<
  CookieSigner,
  "flareosaur/http/SignedCookie/CookieSigner",
  { readonly key: CryptoKey }
> = Context.Service<CookieSigner, { readonly key: CryptoKey }>()(
  "flareosaur/http/SignedCookie/CookieSigner",
)

/** The HMAC key used to sign and verify cookies. */
export class CookieSigner extends CookieSignerBase {}

/** The hash functions an HMAC signing key can use. */
export type Hash = "SHA-256" | "SHA-384" | "SHA-512"

/** Imports a secret as an HMAC key for signing and verifying. */
export const importKey = (
  secret: Redacted.Redacted<string | Uint8Array>,
  hash: Hash = "SHA-256",
): Effect.Effect<CryptoKey, SignedCookieError> =>
  Effect.tryPromise({
    try: () => {
      const raw = Redacted.value(secret)
      const bytes = typeof raw === "string" ? new TextEncoder().encode(raw) : raw
      return crypto.subtle.importKey("raw", bytes as Uint8Array<ArrayBuffer>, { name: "HMAC", hash }, false, [
        "sign",
        "verify",
      ])
    },
    catch: fail,
  })

/** A {@linkcode CookieSigner} whose key is imported from a secret. */
export const layer = (
  secret: Redacted.Redacted<string | Uint8Array>,
  hash: Hash = "SHA-256",
): Layer.Layer<CookieSigner, SignedCookieError> =>
  Layer.effect(CookieSigner, Effect.map(importKey(secret, hash), (key) => CookieSigner.of({ key })))

/** A {@linkcode CookieSigner} with an existing HMAC `CryptoKey`. */
export const layerKey = (key: CryptoKey): Layer.Layer<CookieSigner> => Layer.succeed(CookieSigner, CookieSigner.of({ key }))

/** Signs a value with a key: `value.hexSignature`. */
export const signWith = (value: string, key: CryptoKey): Effect.Effect<string, SignedCookieError> =>
  Effect.tryPromise({ try: () => signCookie(value, key), catch: fail })

const HEX = /^(?:[0-9a-fA-F]{2})+$/

/**
 * Verifies a signed value with a key, returning the original value when the
 * signature is valid and `None` when it is missing, malformed or wrong.
 */
export const verifyWith = (signed: string, key: CryptoKey): Effect.Effect<Option.Option<string>, SignedCookieError> => {
  const dot = signed.lastIndexOf(".")
  if (dot <= 0 || !HEX.test(signed.slice(dot + 1))) return Effect.succeedNone
  return Effect.tryPromise({ try: () => verifySignedCookie(signed, key), catch: fail }).pipe(
    Effect.map((valid) => valid ? Option.some(signed.slice(0, dot)) : Option.none()),
  )
}

/** Signs a value with the {@linkcode CookieSigner} key. */
export const sign = (value: string): Effect.Effect<string, SignedCookieError, CookieSigner> =>
  Effect.flatMap(Effect.service(CookieSigner), ({ key }) => signWith(value, key))

/** Verifies a signed value with the {@linkcode CookieSigner} key. */
export const verify = (signed: string): Effect.Effect<Option.Option<string>, SignedCookieError, CookieSigner> =>
  Effect.flatMap(Effect.service(CookieSigner), ({ key }) => verifyWith(signed, key))

/**
 * The value part of a signed cookie, *without* verifying it. Use only where
 * tampering does not matter.
 */
export const unverifiedValue = (signed: string): string => parseSignedCookie(signed)

/** Signs `value` and sets it as cookie `name` on the response. */
export const setCookie: {
  (name: string, value: string, options?: Cookies.Cookie["options"]): (
    self: HttpServerResponse.HttpServerResponse,
  ) => Effect.Effect<HttpServerResponse.HttpServerResponse, SignedCookieError | Cookies.CookiesError, CookieSigner>
  (
    self: HttpServerResponse.HttpServerResponse,
    name: string,
    value: string,
    options?: Cookies.Cookie["options"],
  ): Effect.Effect<HttpServerResponse.HttpServerResponse, SignedCookieError | Cookies.CookiesError, CookieSigner>
} = Function.dual(
  (args) => HttpServerResponse.isHttpServerResponse(args[0]),
  (self: HttpServerResponse.HttpServerResponse, name: string, value: string, options?: Cookies.Cookie["options"]) =>
    Effect.flatMap(sign(value), (signed) => HttpServerResponse.setCookie(self, name, signed, options)),
)

/**
 * Reads cookie `name` from the current request and verifies it. `None` when
 * the cookie is absent or its signature is invalid.
 */
export const getCookie = (
  name: string,
): Effect.Effect<Option.Option<string>, SignedCookieError, CookieSigner | HttpServerRequest.HttpServerRequest> =>
  Effect.flatMap(Effect.service(HttpServerRequest.HttpServerRequest), (request) => {
    const signed = request.cookies[name]
    return signed === undefined ? Effect.succeedNone : verify(signed)
  })
