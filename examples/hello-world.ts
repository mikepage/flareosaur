/**
 * @title Hello World
 * @difficulty beginner
 * @tags workers, http
 * @group Basics
 * @resource {https://developers.cloudflare.com/workers/runtime-apis/handlers/fetch/} Workers: fetch handler
 * @resource {https://effect.website/docs/getting-started/the-effect-type/} Effect: the Effect type
 * @check GET / -> 200 "Hello, World!"
 *
 * The smallest Worker you can write with Effect: a fetch handler that
 * returns a response. Where Deno has `Deno.serve`, a Worker exports its
 * handlers, and `Worker.make` builds that export from Effects.
 */

import { Effect } from "effect"
import * as Worker from "@mikepage/flareosaur/workers/worker"

// The default export is what the Workers runtime calls. Worker.make turns
// Effect handlers into that object.
export default Worker.make({
  // A fetch handler receives the Request and returns an Effect that
  // produces a Response.
  fetch: () => Effect.succeed(new Response("Hello, World!")),
})
