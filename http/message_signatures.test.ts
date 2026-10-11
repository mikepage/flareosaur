// Copyright 2018-2026 the Deno authors. MIT license.
// Copyright 2026 the flareosaur authors. MIT license.
import { Effect, Option } from "effect"
import { HttpClientRequest, HttpServerRequest } from "effect/http"
import { describe, it } from "../testing/mod.ts"
import { assertEquals, assertFailsWithTag, assertFailure, assertStringIncludes, assertSuccess } from "../assert/mod.ts"
import * as MessageSignatures from "./MessageSignatures.ts"

const ed25519 = Effect.promise(() =>
  crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]) as Promise<CryptoKeyPair>
)
const hmac = Effect.promise(() =>
  crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, true, ["sign", "verify"]) as Promise<CryptoKey>
)

const request = () =>
  new Request("https://example.com/foo?param=Value&Pet=dog", {
    method: "POST",
    headers: { "content-type": "application/json", "content-digest": "sha-256=:X48E9q:" },
  })

const now = () => Math.floor(Date.now() / 1000)

describe("signatureBase", () => {
  it("builds the RFC 9421 signature base", () => {
    const base = assertSuccess(
      MessageSignatures.signatureBase(request(), { components: ["@method", "@authority", "@path", "content-type"], created: 1618884473, keyId: "k" }),
    )
    assertEquals(
      base,
      [
        `"@method": POST`,
        `"@authority": example.com`,
        `"@path": /foo`,
        `"content-type": application/json`,
        `"@signature-params": ("@method" "@authority" "@path" "content-type");created=1618884473;keyid="k"`,
      ].join("\n"),
    )
  })

  it("fails on invalid components", () => {
    const error = assertFailure(MessageSignatures.signatureBase(request(), { components: ["@method", "@method"] }))
    assertStringIncludes(error.message, "Duplicate component identifier")
    assertEquals(assertFailure(MessageSignatures.signatureBase(request(), { components: ["Content-Type"] }))._tag, "MessageSignatureError")
  })
})

describe("sign / verify", () => {
  it.live("round-trips with Ed25519", () =>
    Effect.gen(function*() {
      const { privateKey, publicKey } = yield* ed25519
      const signed = yield* MessageSignatures.sign(request(), {
        key: privateKey,
        params: { components: ["@method", "@target-uri", "content-digest"], keyId: "k1", created: now() },
      })
      assertStringIncludes(signed.headers.get("Signature-Input")!, `sig=("@method" "@target-uri" "content-digest")`)
      const results = yield* MessageSignatures.verify(signed, (keyId, alg) =>
        Effect.succeed(keyId === "k1" && Option.isNone(alg) ? Option.some(publicKey) : Option.none()))
      assertEquals(results.map((r) => r.label), ["sig"])
      assertEquals(results[0]!.params.keyId, "k1")
    }))

  it.live("rejects tampered messages, unknown keys and missing headers", () =>
    Effect.gen(function*() {
      const key = yield* hmac
      const signed = yield* MessageSignatures.sign(request(), {
        key,
        params: { components: ["@method", "content-type"], keyId: "h", algorithm: "hmac-sha256" },
      })
      const lookup = (keyId: string) => Effect.succeed(keyId === "h" ? Option.some(key) : Option.none())
      const tampered = new Request(signed, { headers: { ...Object.fromEntries(signed.headers), "content-type": "text/plain" } })
      const bad = yield* assertFailsWithTag(MessageSignatures.verify(tampered, lookup), "MessageSignatureError")
      assertStringIncludes(bad.message, "verification failed")
      const unknown = yield* assertFailsWithTag(
        MessageSignatures.verify(signed, () => Effect.succeedNone),
        "MessageSignatureError",
      )
      assertStringIncludes(unknown.message, "Key not found")
      const missing = yield* assertFailsWithTag(MessageSignatures.verify(request(), lookup), "MessageSignatureError")
      assertStringIncludes(missing.message, "Signature-Input")
    }))

  it.live("enforces required components, maxAge and labels", () =>
    Effect.gen(function*() {
      const key = yield* hmac
      const lookup = () => Effect.succeed(Option.some(key))
      const old = yield* MessageSignatures.sign(request(), {
        key,
        params: { components: ["@method"], created: now() - 3600, label: "old" },
      })
      const required = yield* assertFailsWithTag(
        MessageSignatures.verify(old, lookup, { requiredComponents: ["@path"] }),
        "MessageSignatureError",
      )
      assertStringIncludes(required.message, "does not cover required component")
      yield* assertFailsWithTag(MessageSignatures.verify(old, lookup, { maxAge: "1 minute" }), "MessageSignatureError")
      assertEquals((yield* MessageSignatures.verify(old, lookup, { maxAge: "2 hours" })).length, 1)
      const both = yield* MessageSignatures.sign(old, {
        key,
        params: { components: ["@path"], label: "new" },
      })
      assertEquals((yield* MessageSignatures.verify(both, lookup, { labels: ["new"] })).map((r) => r.label), ["new"])
      assertEquals((yield* MessageSignatures.verify(both, lookup)).map((r) => r.label), ["old", "new"])
      yield* assertFailsWithTag(
        MessageSignatures.sign(both, { key, params: { components: ["@path"], label: "new" } }),
        "MessageSignatureError",
      )
    }))

  it.live("propagates key lookup failures", () =>
    Effect.gen(function*() {
      const key = yield* hmac
      const signed = yield* MessageSignatures.sign(request(), { key, params: { components: ["@method"], keyId: "x" } })
      const error = yield* assertFailsWithTag(
        MessageSignatures.verify(signed, () => Effect.fail({ _tag: "LookupError" as const })),
        "LookupError",
      )
      assertEquals(error._tag, "LookupError")
    }))
})

describe("Effect HTTP bridges", () => {
  it.live("signs an HttpClientRequest and verifies it as an HttpServerRequest", () =>
    Effect.gen(function*() {
      const { privateKey, publicKey } = yield* ed25519
      const clientRequest = yield* MessageSignatures.signClientRequest(
        HttpClientRequest.post("https://example.com/api", { headers: { "content-type": "application/json" } }),
        { key: privateKey, params: { components: ["@method", "@authority", "@path", "content-type"], keyId: "k" } },
      )
      const web = yield* HttpClientRequest.toWeb(clientRequest)
      const lookup = (keyId: string) => Effect.succeed(keyId === "k" ? Option.some(publicKey) : Option.none())
      const verified = yield* MessageSignatures.verifyRequest(lookup).pipe(
        Effect.provideService(HttpServerRequest.HttpServerRequest, HttpServerRequest.fromWeb(web)),
      )
      assertEquals(verified.map((r) => r.params.keyId), ["k"])
      const moved = new Request("https://example.com/other", { method: "POST", headers: web.headers })
      yield* assertFailsWithTag(
        MessageSignatures.verifyRequest(lookup).pipe(
          Effect.provideService(HttpServerRequest.HttpServerRequest, HttpServerRequest.fromWeb(moved)),
        ),
        "MessageSignatureError",
      )
    }))
})
