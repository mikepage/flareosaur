/**
 * @title Cookies
 * @difficulty beginner
 * @tags workers, http
 * @group HTTP
 * @resource {https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies} MDN: HTTP cookies
 * @resource {https://jsr.io/@std/http/doc/cookie} @std/http: cookie
 * @check GET /visit -> 200 "first visit" header:set-cookie~"visits=1"
 * @check GET /visit h:cookie=visits=4 -> 200 "visit number 5" header:set-cookie~"visits=5"
 * @check GET /visit h:cookie=visits=nonsense -> 200 "first visit" header:set-cookie~"visits=1"
 * @check GET /logout -> 200 "Logged out" header:set-cookie~"Expires=Thu, 01 Jan 1970"
 *
 * Cookies carry state between requests. The browser sends them in the
 * `Cookie` header and the server sets them with `Set-Cookie`. std's cookie
 * module parses the one and writes the other, checking names, values and
 * attributes as it goes.
 */

import {
  deleteCookie,
  getCookies,
  setCookie,
} from "@mikepage/flareosaur/http/cookie";

const THIRTY_DAYS = 60 * 60 * 24 * 30;

function visit(request: Request): Response {
  // getCookies parses the Cookie header into a plain object. A missing
  // cookie is undefined.
  const cookies = getCookies(request.headers);

  // A cookie is just text the client sent, so validate it. Anything that is
  // not a whole number counts as a first visit.
  const previous = Number(cookies.visits ?? 0);
  const visits = (Number.isInteger(previous) && previous >= 0 ? previous : 0) +
    1;

  const body = visits === 1
    ? "Welcome, first visit!"
    : `Welcome back, visit number ${visits}`;

  // setCookie appends a Set-Cookie header with the given attributes.
  const headers = new Headers({ "content-type": "text/plain" });
  setCookie(headers, {
    name: "visits",
    value: String(visits),
    path: "/",
    httpOnly: true,
    maxAge: THIRTY_DAYS,
  });
  return new Response(body, { headers });
}

function logout(): Response {
  // deleteCookie sets the cookie to an empty value that expired in 1970.
  // The path must match the one the cookie was set with.
  const headers = new Headers({ "content-type": "text/plain" });
  deleteCookie(headers, "visits", { path: "/" });
  return new Response("Logged out", { headers });
}

export default {
  fetch(request: Request): Response {
    const { pathname } = new URL(request.url);
    if (pathname === "/visit") return visit(request);
    if (pathname === "/logout") return logout();
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler;
