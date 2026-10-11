/**
 * @title Hello World
 * @difficulty beginner
 * @tags workers, http
 * @group Basics
 * @resource {https://developers.cloudflare.com/workers/runtime-apis/handlers/fetch/} Workers: fetch handler
 * @check GET / -> 200 "Hello, World!"
 *
 * The smallest Worker: a fetch handler that returns a response. Where Deno
 * has `Deno.serve`, a Worker exports an object with its handlers. There is
 * nothing to install and no server to start.
 */

export default {
  // The runtime calls fetch for every request. It gets the Request, the
  // bindings (env) and an ExecutionContext, and returns a Response.
  fetch(_request: Request): Response {
    return new Response("Hello, World!");
  },
} satisfies ExportedHandler;
