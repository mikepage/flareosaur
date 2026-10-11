/**
 * @title Routing
 * @difficulty beginner
 * @tags workers, http
 * @group HTTP
 * @resource {https://developer.mozilla.org/en-US/docs/Web/API/URLPattern} MDN: URLPattern
 * @resource {https://jsr.io/@std/http/doc/unstable-route} @std/http: route
 * @check GET / -> 200 "Welcome"
 * @check GET /books/42 -> 200 "\"id\":42" "Book 42"
 * @check GET /books/abc -> 400 "Bad id"
 * @check POST /books -> 201 "created"
 * @check DELETE /books -> 405
 * @check GET /missing -> 404
 *
 * `URLPattern` is the web's route matcher: it matches a URL against a
 * pattern such as `/books/:id` and hands back the named groups. std's
 * `route` turns a list of patterns, methods and handlers into a fetch
 * handler.
 */

import { type Route, route } from "@mikepage/flareosaur/http/unstable-route";

// Every route is a pattern, an optional method and a handler. The handler
// gets the request, the URLPattern match, and whatever the router was
// called with (here env and ctx).
const routes: Route[] = [
  {
    pattern: new URLPattern({ pathname: "/" }),
    method: "GET",
    handler: () => new Response("Welcome to the library"),
  },
  {
    // Groups arrive as strings, so check and convert them. A pattern can
    // also carry a regular expression (`/books/:id(\\d+)`), but then
    // `/books/abc` is a plain 404 instead of a helpful 400.
    pattern: new URLPattern({ pathname: "/books/:id" }),
    method: "GET",
    handler: (_request, match) => {
      const id = Number(match.pathname.groups.id);
      if (!Number.isSafeInteger(id) || id < 0) {
        return new Response("Bad id", { status: 400 });
      }
      return Response.json({ id, title: `Book ${id}` });
    },
  },
  {
    pattern: new URLPattern({ pathname: "/books" }),
    method: "POST",
    handler: () => new Response("created", { status: 201 }),
  },
  {
    // Any other method on /books: say which ones are allowed.
    pattern: new URLPattern({ pathname: "/books" }),
    handler: () =>
      new Response("Method not allowed", {
        status: 405,
        headers: { allow: "POST" },
      }),
  },
];

// Routes are tried in order; the default handler gets everything else.
const notFound = () => new Response("Not found", { status: 404 });

// Building the URLPatterns once per isolate is fine: they are immutable
// values. route returns a function with the fetch handler's signature.
export default {
  fetch: route(routes, notFound),
} satisfies ExportedHandler;
