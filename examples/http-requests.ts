/**
 * @title Make HTTP requests
 * @difficulty beginner
 * @tags workers, http
 * @group HTTP
 * @bindings outbound:echo
 * @resource {https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch} MDN: Using the Fetch API
 * @resource {https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static} MDN: AbortSignal.timeout()
 * @resource {https://developers.cloudflare.com/workers/runtime-apis/fetch/} Workers: fetch
 * @resource {https://jsr.io/@std/async/doc/retry} @std/async: retry
 * @check GET / -> 200 "GET https://api.example.com/users?page=2" "POST body: {\"name\":\"Ada\"}" "status 503 ok: false" "retried 3 times" "slow request: TimeoutError"
 *
 * `fetch` is built into Workers, the same API as in the browser. Add query
 * parameters with `URL`, send JSON with `JSON.stringify`, cancel slow
 * requests with `AbortSignal.timeout`, and retry transient failures with
 * std's `retry`.
 */

import { retry } from "@mikepage/flareosaur/async/retry";
import { script } from "./_lib/script.ts";

// The (fake) upstream echoes each request back as JSON.
interface Echo {
  method: string;
  url: string;
  body: string | null;
}

export default script(async (print) => {
  // GET with query parameters. URL encodes them for you.
  const url = new URL("https://api.example.com/users");
  url.searchParams.set("page", "2");
  const page = await fetch(url).then((r) => r.json<Echo>());
  print(`${page.method} ${page.url}`);

  // POST a JSON body. Say what it is with Content-Type.
  const created = await fetch("https://api.example.com/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Ada" }),
  }).then((r) => r.json<Echo>());
  print(`POST body: ${created.body}`);

  // fetch only rejects on network errors. A 503 is a normal response, so
  // check `ok` (status 200-299) yourself.
  const failed = await fetch("https://api.example.com/status/503");
  print(`status ${failed.status} ok: ${failed.ok}`);

  // Retry transient failures. retry calls the function again, with
  // exponential backoff, until it resolves or maxAttempts is reached.
  let attempts = 0;
  await retry(async () => {
    attempts++;
    const response = await fetch("https://api.example.com/status/503");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response;
  }, { maxAttempts: 3, minTimeout: 10 }).catch(() => {});
  print(`retried ${attempts} times`);

  // Give up on a slow upstream. AbortSignal.timeout aborts the request
  // after 100 ms and fetch rejects with a TimeoutError.
  try {
    await fetch("https://api.example.com/slow", {
      signal: AbortSignal.timeout(100),
    });
  } catch (error) {
    print(`slow request: ${(error as Error).name}`);
  }
});
