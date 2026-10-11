/**
 * @title Verify webhook signatures
 * @difficulty intermediate
 * @tags workers, http, crypto, security
 * @group Cryptography
 * @bindings var:WEBHOOK_SECRET=whsec_test_secret
 * @resource {https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/verify} MDN: SubtleCrypto.verify
 * @resource {https://developers.cloudflare.com/workers/configuration/secrets/} Workers: secrets
 * @resource {https://jsr.io/@std/encoding} @std/encoding
 * @check POST /webhooks h:x-signature=sha256=6a3d3c0e2f3c4c49f9b6dc17ab8ee0b0bbb0c92c8af1d0b6c3e3bd6b1a2e7c9d {"event":"paid"} -> 401 "bad signature"
 * @check POST /webhooks h:x-signature=sha256=nothex {"event":"paid"} -> 401 "bad signature"
 * @check POST /webhooks/selftest -> 200 "accepted: paid"
 *
 * Webhook senders sign each delivery with a shared secret so the receiver
 * can reject forgeries. Verify the HMAC of the raw body before parsing it.
 * `crypto.subtle.verify` compares in constant time, so the check leaks
 * nothing about the expected signature. Keep the secret in a Worker secret.
 */

import { decodeHex, encodeHex } from "@mikepage/flareosaur/encoding/hex";

interface Env {
  WEBHOOK_SECRET: string;
}

// An HMAC-SHA-256 key from the secret, for signing and verifying.
function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

// Checks "x-signature: sha256=<hex>" against the raw body.
async function isSigned(body: string, header: string | null, secret: string) {
  if (!header?.startsWith("sha256=")) return false;
  let signature: Uint8Array;
  try {
    signature = decodeHex(header.slice("sha256=".length));
  } catch {
    return false;
  }
  return crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    signature,
    new TextEncoder().encode(body),
  );
}

async function receive(request: Request, env: Env): Promise<Response> {
  // Read the body as text first: the signature covers these exact bytes,
  // and parsing then re-serializing JSON would change them.
  const body = await request.text();
  if (
    !await isSigned(
      body,
      request.headers.get("x-signature"),
      env.WEBHOOK_SECRET,
    )
  ) {
    return new Response("bad signature", { status: 401 });
  }
  // Only now is the body trusted enough to parse.
  const { event } = JSON.parse(body) as { event: string };
  return new Response(`accepted: ${event}`);
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (request.method !== "POST") {
      return new Response("method not allowed", { status: 405 });
    }

    if (pathname === "/webhooks") return receive(request, env);

    // The sender's side, to show a signature that verifies: sign a body with
    // the same secret and deliver it to the receiver.
    if (pathname === "/webhooks/selftest") {
      const body = JSON.stringify({ event: "paid" });
      const mac = await crypto.subtle.sign(
        "HMAC",
        await hmacKey(env.WEBHOOK_SECRET),
        new TextEncoder().encode(body),
      );
      const delivery = new Request(new URL("/webhooks", request.url), {
        method: "POST",
        headers: { "x-signature": `sha256=${encodeHex(mac)}` },
        body,
      });
      return receive(delivery, env);
    }

    return new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
