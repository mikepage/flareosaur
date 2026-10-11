/**
 * @title Parse URLs and match routes with URLPattern
 * @difficulty beginner
 * @tags workers, web
 * @group Standard library
 * @resource {https://developer.mozilla.org/en-US/docs/Web/API/URLPattern} MDN: URLPattern
 * @resource {https://developer.mozilla.org/en-US/docs/Web/API/URL} MDN: URL
 * @check GET / -> 200 "host: example.com" "query now: q=workers" "user 42 / post hello-world" "no match: null" "typed: {\"id\":42,\"slug\":\"hello-world\"}" "bad id: null" "any host: true"
 *
 * `URL` parses and edits URLs, and `URLPattern` (built into Workers)
 * matches them against route patterns. Pattern groups are strings, so
 * convert and check them yourself. A regular expression in the pattern
 * can reject bad input before your code sees it.
 */

import { script } from "./_lib/script.ts";

// Patterns are immutable, so build them once at the top level. A group can
// carry a regular expression: here the id must be digits.
const post = new URLPattern({ pathname: "/users/:id(\\d+)/posts/:slug" });

export default script((print) => {
  // URL splits a URL into parts, and searchParams edits the query.
  const url = new URL("https://example.com/search?q=workers&page=2#top");
  print(`host: ${url.host}, path: ${url.pathname}`);
  url.searchParams.delete("page");
  print(`query now: ${url.searchParams}`);

  // exec returns the match, with named groups per URL part, or null.
  const hit = post.exec("https://example.com/users/42/posts/hello-world");
  const { id, slug } = hit?.pathname.groups ?? {};
  print(`user ${id} / post ${slug}`);
  print(`no match: ${post.exec("https://example.com/about")}`);

  // Groups are strings. Turn them into the values your code expects.
  if (id && slug) print(`typed: ${JSON.stringify({ id: Number(id), slug })}`);

  // The \d+ in the pattern rejects a non-numeric id.
  print(`bad id: ${post.exec("https://example.com/users/ada/posts/x")}`);

  // test only answers yes or no. Unspecified parts, like the host, match
  // anything.
  print(`any host: ${post.test("http://localhost:8787/users/7/posts/hi")}`);
});
