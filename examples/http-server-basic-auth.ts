/**
 * @title Basic authentication
 * @difficulty intermediate
 * @tags workers, http, security
 * @group HTTP
 * @bindings var:ADMIN_PASSWORD=correct-horse
 * @resource {https://developer.mozilla.org/en-US/docs/Web/HTTP/Authentication} MDN: HTTP authentication
 * @resource {https://developers.cloudflare.com/workers/examples/basic-auth/} Workers: HTTP Basic Authentication
 * @resource {https://jsr.io/@std/crypto/doc/timing-safe-equal} @std/crypto: timingSafeEqual
 * @check GET /admin -> 401 header:www-authenticate~"Basic"
 * @check GET /admin h:authorization="Basic YWRtaW46d3Jvbmc=" -> 401
 * @check GET /admin h:authorization="Basic !!!" -> 401
 * @check GET /admin h:authorization="Basic YWRtaW46Y29ycmVjdC1ob3JzZQ==" -> 200 "Hello, admin"
 *
 * Basic authentication sends a username and password with every request.
 * The password is a secret, so it comes from the environment (set it with
 * `wrangler secret put`). The comparison takes the same time whatever the
 * input, so the response time leaks nothing about the password.
 */

import { timingSafeEqual } from "@mikepage/flareosaur/crypto/timing-safe-equal";

interface Env {
  ADMIN_PASSWORD: string;
}

// Decodes "Basic base64(user:password)" from the Authorization header.
function credentials(
  request: Request,
): { user: string; password: string } | undefined {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Basic ")) return undefined;
  let decoded: string;
  try {
    // atob decodes base64 to a "binary string" (one char per byte).
    // TextDecoder turns those bytes into UTF-8 text.
    const bytes = Uint8Array.from(
      atob(header.slice(6)),
      (c) => c.charCodeAt(0),
    );
    decoded = new TextDecoder().decode(bytes);
  } catch {
    return undefined; // Not base64.
  }
  // The password may contain ":", the username may not.
  const colon = decoded.indexOf(":");
  if (colon === -1) return undefined;
  return { user: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
}

// Compares two strings in constant time. timingSafeEqual needs inputs of
// the same length, so compare SHA-256 digests: they are always 32 bytes, and
// the length of the password does not leak either.
async function safeEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [x, y] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  return timingSafeEqual(x, y);
}

function unauthorized(): Response {
  return new Response("Unauthorized", {
    status: 401,
    headers: { "www-authenticate": `Basic realm="admin", charset="UTF-8"` },
  });
}

export default {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname !== "/admin") {
      return new Response("Not found", { status: 404 });
    }

    const given = credentials(request);
    if (!given) return unauthorized();
    // Check both, always, so a wrong username takes as long as a wrong
    // password.
    const userOk = await safeEqual(given.user, "admin");
    const passwordOk = await safeEqual(given.password, env.ADMIN_PASSWORD);
    if (!userOk || !passwordOk) return unauthorized();

    return new Response(`Hello, ${given.user}`);
  },
} satisfies ExportedHandler<Env>;
