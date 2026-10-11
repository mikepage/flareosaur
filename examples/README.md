# flareosaur examples

Effect v4 versions of the [Deno examples](https://docs.deno.com/examples/), as Cloudflare Workers.
Each file is a Worker with a commented walkthrough. They run in workerd with no `nodejs_compat`,
and `npm run examples` checks every one of them in Miniflare.

Run one locally with `npx wrangler dev examples/<name>.ts` (add the bindings listed in its header).

16 examples in 3 groups.

## Basics

| Example | What it shows |
| --- | --- |
| [Add a timeout to any effect](timeout-any-effect.ts) | A promise has no built-in time limit. Every effect does: `Effect.timeout` fails with a `TimeoutError` when the time runs out, and interrupts the work that was too slow, so nothing keeps running in the background. |
| [Check if two values are deeply equal](deep-equal.ts) | Two objects with the same contents are not equal with `===`. Effect's `Equal.equals` compares structurally: plain objects, arrays, Maps, Sets and Dates by value, and Effect data types (Data classes, Option, HashMap, ...) by their own equality. |
| [Exponential backoff](exponential-backoff.ts) | Exponential backoff retries a failing operation with growing delays, so a struggling service gets room to recover. In Effect the policy is a `Schedule`, and `Effect.retry` applies it. Errors are typed, so the policy can decide which ones are worth retrying. |
| [Generate seeded random numbers](seeded-random.ts) | `Math.random` cannot be seeded, so tests that depend on it are flaky. Effect reads randomness from the `Random` service: run the same code with `Random.withSeed` and it produces the same numbers every time. |
| [Hello World](hello-world.ts) | The smallest Worker you can write with Effect: a fetch handler that returns a response. Where Deno has `Deno.serve`, a Worker exports its handlers, and `Worker.make` builds that export from Effects. |
| [Memoize an expensive function](memoize.ts) | Memoization caches the result of a call so repeated calls are free. Effect's `Cache` memoizes an effectful lookup with a capacity and a time to live, and concurrent lookups of the same key share one computation. |
| [Run tasks with a concurrency limit](concurrency-limit.ts) | Firing hundreds of requests at once can overload a service or hit a rate limit. `Effect.forEach` takes a `concurrency` option, and a `Semaphore` limits concurrency across unrelated parts of a program. |
| [Set timeouts and intervals with schedules](repeat-with-schedules.ts) | Where a Deno script reaches for `setTimeout` and `setInterval`, Effect uses schedules: values that describe when to run something again. They compose, they stop on their own, and they work with the test clock. |
| [Sleep and delay execution](sleep-and-delay.ts) | Programs often need to wait: between retries, while polling, or to pace requests. In Effect a sleep is just another effect: it never blocks, it reads time from the `Clock` (so tests can fast-forward it), and it can be interrupted. |

## Cloudflare runtime

| Example | What it shows |
| --- | --- |
| [R2: reading and writing files](r2-files.ts) | A Worker has no disk; files go to an R2 bucket. The `R2.Bucket` service covers what the Deno examples do with `Deno.readFile`, `Deno.writeFile`, `Deno.remove` and walking a directory, with typed errors and `Option` for missing files. Object bodies are Effect `Stream`s, so large files never have to fit in memory. |
| [Workers KV: key/value storage](kv.ts) | Deno has Deno KV built in; a Worker gets Workers KV through a binding. `Kv.layer` provides it as Effect's `KeyValueStore`, so a Schema-validated store is one call away: values are checked when they are written and when they are read back. |

## HTTP

| Example | What it shows |
| --- | --- |
| [HTTP requests](http-requests.ts) | Effect's `HttpClient` wraps `fetch` with typed errors, Schema-decoded responses, retries and timeouts. On Workers it runs on the runtime's own `fetch` through `FetchHttpClient.layer`. |
| [HTTP server: cookies](http-server-cookies.ts) | Cookies carry state between requests. Read them from the request with a Schema (so a tampered value is rejected), and set or expire them on the response; Effect checks names, values and options when it serializes them. |
| [HTTP server: CORS](http-server-cors.ts) | Browsers block cross-origin requests unless the server opts in. Add `HttpRouter.cors` to the routes and the router answers preflight requests and adds the CORS headers to every response. |
| [HTTP server: routing](http-server-routing.ts) | `HttpRouter` maps methods and paths to handlers. Path parameters are decoded with a Schema, so `/books/abc` is rejected before the handler runs. `Worker.make` serves the router as the Worker's fetch handler. |
| [HTTP server: validate JSON bodies](http-server-validate-json.ts) | Never trust a request body. `HttpServerRequest.schemaBodyJson` parses the body and decodes it with a Schema in one step; a body that does not match fails with a `SchemaError` that says exactly what is wrong. |
