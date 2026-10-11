/**
 * @title Sessions with signed cookies
 * @difficulty intermediate
 * @tags workers, http, security
 * @group HTTP
 * @bindings var:COOKIE_SECRET=change-me-to-a-long-random-string
 * @resource {https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies} MDN: HTTP cookies
 * @resource {https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/importKey} MDN: SubtleCrypto.importKey()
 * @resource {https://jsr.io/@std/http/doc/unstable-signed-cookie} @std/http: signed cookies
 * @check GET /me -> 401 "not logged in"
 * @check POST /login/ada -> 200 "logged in as ada" header:set-cookie~"session=ada."
 * @check GET /me h:cookie="{{prev:set-cookie}}" -> 200 "hello, ada"
 * @check GET /me h:cookie=session=ada.forged -> 401
 *
 * A session cookie must not be editable by the client, or anyone could
 * claim to be anyone. A signed cookie carries an HMAC of its value: the
 * server verifies it on every request and treats a tampered cookie as no
 * cookie at all. The signing key comes from a secret binding.
 */

import { getCookies, setCookie } from "@mikepage/flareosaur/http/cookie";
import {
  parseSignedCookie,
  signCookie,
  verifySignedCookie,
} from "@mikepage/flareosaur/http/unstable-signed-cookie";

interface Env {
  // Set it with `wrangler secret put COOKIE_SECRET`.
  COOKIE_SECRET: string;
}

// Turns the secret into an HMAC key with Web Crypto. Importing a raw key is
// cheap, so this runs per request instead of caching a key per isolate.
function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

const LOGIN = new URLPattern({ pathname: "/login/:user([a-z]+)" });

export default {
  async fetch(request, env) {
    const key = await hmacKey(env.COOKIE_SECRET);

    const login = LOGIN.exec(request.url);
    if (request.method === "POST" && login) {
      const user = login.pathname.groups.user!;
      const headers = new Headers();
      // signCookie appends "." and the hex HMAC to the value.
      setCookie(headers, {
        name: "session",
        value: await signCookie(user, key),
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
        path: "/",
      });
      return new Response(`logged in as ${user}`, { headers });
    }

    if (request.method === "GET" && new URL(request.url).pathname === "/me") {
      const session = getCookies(request.headers).session;
      // A missing cookie and a forged one are treated the same. A signature
      // that is not even hex makes verifySignedCookie throw, so that counts
      // as forged too.
      const valid = session !== undefined &&
        await verifySignedCookie(session, key).catch(() => false);
      if (!valid) {
        return new Response("not logged in", { status: 401 });
      }
      return new Response(`hello, ${parseSignedCookie(session)}`);
    }

    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
