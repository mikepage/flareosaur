/**
 * @title Request timeouts
 * @difficulty intermediate
 * @tags workers, http
 * @group HTTP
 * @bindings outbound:echo
 * @resource {https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static} MDN: AbortSignal.timeout()
 * @resource {https://developers.cloudflare.com/workers/runtime-apis/fetch/} Cloudflare: fetch
 * @check GET /fast -> 200 "upstream answered" "/fast"
 * @check GET /slow -> 504 "took too long"
 *
 * A handler that waits on a slow upstream can hold a request open far too
 * long. Give the upstream call a budget with `AbortSignal.timeout`: when it
 * runs out, the fetch is aborted, not left running, and the client gets a
 * 504.
 */

// The upstream API. In the checks every outgoing fetch is answered by an
// echo server, which takes two seconds on /slow.
const UPSTREAM = "https://upstream.example";

export default {
  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    try {
      // AbortSignal.timeout gives a signal that aborts after 500 ms.
      // fetch rejects with a "TimeoutError" DOMException when it fires.
      const upstream = await fetch(`${UPSTREAM}${pathname}`, {
        signal: AbortSignal.timeout(500),
      });
      const body = await upstream.json<{ url: string }>();
      return new Response(`upstream answered for ${body.url}`);
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") {
        return new Response("The upstream took too long", { status: 504 });
      }
      throw error;
    }
  },
} satisfies ExportedHandler;
