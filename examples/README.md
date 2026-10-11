# flareosaur examples

Effect v4 versions of the [Deno examples](https://docs.deno.com/examples/), as Cloudflare Workers.
Each file is a Worker with a commented walkthrough. They run in workerd with no `nodejs_compat`,
and `npm run examples` checks every one of them in Miniflare.

Run one locally with `npx wrangler dev examples/<name>.ts` (add the bindings listed in its header).

40 examples in 7 groups.

## Basics

| Example | What it shows |
| --- | --- |
| [Add a timeout to any effect](timeout-any-effect.ts) | A promise has no built-in time limit. Every effect does: `Effect.timeout` fails with a `TimeoutError` when the time runs out, and interrupts the work that was too slow, so nothing keeps running in the background. |
| [Cancel async work with interruption](cancel-with-interruption.ts) | Deno cancels work with an `AbortController` passed down by hand. In Effect, cancellation is interruption: any running effect can be interrupted, and its finalizers run, without threading a signal through every call. An `AbortSignal` from outside can still trigger it. |
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
| [Cache responses with the Cache API](cache-api.ts) | Deno implements the Web Cache API; Workers have it too, as `caches.default`, in front of every data center. `Cache.cached` serves a request from the cache or runs the effect, returns its response and stores a copy in the background with `ctx.waitUntil`, so the user never waits for the write. |
| [Cron Triggers](cron.ts) | `Deno.cron` registers a function to run on a schedule. On Workers the schedules live in the Worker's configuration (`triggers.crons`) and every trigger calls the `scheduled` handler. `Scheduled.dispatch` routes each trigger to the effect registered for its expression, and checks the expressions with Effect's `Cron` parser when the Worker loads. |
| [D1: SQL with Effect](d1-sql.ts) | The Deno examples use SQLite through `node:sqlite`; a Worker has D1, a SQLite database as a binding. `@effect/sql-d1` makes it an Effect `SqlClient`: queries are tagged templates with parameters bound safely, and rows are decoded with a Schema. |
| [Durable Objects: a consistent counter](durable-object-counter.ts) | A Durable Object is a single instance with its own storage: every request for the same name reaches the same object, one at a time, so a counter never loses an update. `DurableObject.makeRunner` runs Effects inside the object with its storage as Effect's `KeyValueStore`. |
| [Environment variables and secrets](environment-variables.ts) | Deno reads configuration with `Deno.env.get`. A Worker gets vars and secrets as bindings, and `Worker.make` exposes the string ones to Effect's `Config`: typed (numbers, booleans, durations), with defaults, and with `Config.Redacted` for secrets so they never end up in a log line. |
| [Queues: offload work to a consumer](queues.ts) | Deno Queues let an app hand work to a background listener. On Workers the same thing is a Queue with a producer binding and a `queue` handler. With `Queue.Producer` and `Queue.consume`, messages are Schema-typed on both ends: a message that does not decode is logged and dropped instead of crashing the consumer or retrying forever. |
| [R2: reading and writing files](r2-files.ts) | A Worker has no disk; files go to an R2 bucket. The `R2.Bucket` service covers what the Deno examples do with `Deno.readFile`, `Deno.writeFile`, `Deno.remove` and walking a directory, with typed errors and `Option` for missing files. Object bodies are Effect `Stream`s, so large files never have to fit in memory. |
| [WebSocket chat with Durable Objects](websocket-chat.ts) | A chat room needs one place that knows every connected socket. Each room is a Durable Object: the Worker forwards the WebSocket upgrade to the room's object, which accepts the socket with the hibernation API and broadcasts every message to the sockets of that room. The room keeps its last messages in storage, so new visitors can read the history. |
| [Workers KV: key/value storage](kv.ts) | Deno has Deno KV built in; a Worker gets Workers KV through a binding. `Kv.layer` provides it as Effect's `KeyValueStore`, so a Schema-validated store is one call away: values are checked when they are written and when they are read back. |

## Cryptography

| Example | What it shows |
| --- | --- |
| [AES encryption and decryption](aes-encryption.ts) | AES-GCM encrypts and authenticates in one step: a ciphertext that was changed fails to decrypt. The helpers generate a fresh nonce from the Effect `Crypto` service for every message and put it in front of the ciphertext, so the nonce never has to be stored separately. |
| [Generate and validate UUIDs and ULIDs](uuids-and-ulids.ts) | UUID v4 is random, v7 starts with a timestamp so new ids sort last, and v5 is the same for the same name every time. ULIDs are sortable too, in a shorter alphabet. Generation reads time and randomness from Effect services (`Clock`, `Crypto`), so tests can pin both. |
| [Hashing](hashing.ts) | Web Crypto covers the SHA family. `@mikepage/flareosaur/crypto` adds the rest of std's algorithms (BLAKE3, SHA-3, Keccak, MD5, FNV, ...), running as WebAssembly that Workers load as a module, and `digestStream` hashes a `Stream` chunk by chunk, so a large R2 object never has to be in memory. |
| [Hashing and verifying passwords](password-hashing.ts) | Passwords must never be stored in plain text, or hashed with a fast hash. PBKDF2 (available in Web Crypto on Workers) stretches a password with a random salt and many iterations. Store the salt and iteration count with the hash, and compare in constant time when a user logs in. |
| [HTTP server: verifying webhook signatures](webhook-signatures.ts) | Webhook senders sign each delivery with a shared secret so the receiver can reject forgeries. Verify the HMAC of the raw body before parsing it, with a constant-time comparison, and keep the secret in `Config.Redacted`. |

## Encoding

| Example | What it shows |
| --- | --- |
| [Compress and decompress data](compress-decompress.ts) | Workers implement `CompressionStream` and `DecompressionStream`. Wrapped as Effect `Stream` steps, compression is one more stage in a pipeline, whether the data is a string in memory or a large R2 object. |

## HTTP

| Example | What it shows |
| --- | --- |
| [HTTP requests](http-requests.ts) | Effect's `HttpClient` wraps `fetch` with typed errors, Schema-decoded responses, retries and timeouts. On Workers it runs on the runtime's own `fetch` through `FetchHttpClient.layer`. |
| [HTTP server: basic authentication](http-server-basic-auth.ts) | Basic authentication sends a username and password with every request. The password is a secret, so it comes from `Config.Redacted`, and the comparison takes the same time whatever the input, so the response time leaks nothing about the password. |
| [HTTP server: cookies](http-server-cookies.ts) | Cookies carry state between requests. Read them from the request with a Schema (so a tampered value is rejected), and set or expire them on the response; Effect checks names, values and options when it serializes them. |
| [HTTP server: CORS](http-server-cors.ts) | Browsers block cross-origin requests unless the server opts in. Add `HttpRouter.cors` to the routes and the router answers preflight requests and adds the CORS headers to every response. |
| [HTTP server: health checks](http-server-health-checks.ts) | A liveness endpoint answers as long as the Worker runs; a readiness endpoint checks the dependencies. The checks run concurrently, each with a timeout, and a failing check is reported instead of failing the endpoint. |
| [HTTP server: paginating results](http-server-pagination.ts) | APIs that return lists need pagination. Query parameters are decoded with a Schema (with defaults and limits), and the cursor is opaque to the client: a base64url offset it hands back to get the next page. |
| [HTTP server: rate limiting](http-server-rate-limit.ts) | A rate limiter protects a server from clients that send too many requests. A Worker runs in many isolates at once, so in-memory counters would each see only part of the traffic. Give every client its own Durable Object instead: one instance per IP address sees all of that client's requests, and runs Effect's `RateLimiter` with an in-memory store. |
| [HTTP server: request timeouts](http-server-request-timeouts.ts) | A handler that waits on a slow upstream can hold a request open far too long. Give the handler a budget with `Effect.timeout`: when it runs out the work is interrupted, not left running, and the client gets a 504. |
| [HTTP server: routing](http-server-routing.ts) | `HttpRouter` maps methods and paths to handlers. Path parameters are decoded with a Schema, so `/books/abc` is rejected before the handler runs. `Worker.make` serves the router as the Worker's fetch handler. |
| [HTTP server: server-sent events](http-server-sse.ts) | Server-sent events push updates from the server over one long-lived response. The events are an Effect `Stream`, and `Sse.encode` turns it into the `text/event-stream` wire format, so the producer is ordinary stream code: here, a tick every 10ms, three times, then a final event. |
| [HTTP server: streaming responses](http-server-streaming.ts) | A response body can be an Effect `Stream`: bytes go out as they are produced, so the Worker never holds the whole body in memory. Request bodies are streams too, which makes a streaming transform a pipeline. |
| [HTTP server: validate JSON bodies](http-server-validate-json.ts) | Never trust a request body. `HttpServerRequest.schemaBodyJson` parses the body and decodes it with a Schema in one step; a body that does not match fails with a `SchemaError` that says exactly what is wrong. |
| [HTTP server: WebSockets](websocket-echo.ts) | A Worker answers a WebSocket upgrade with one end of a `WebSocketPair` and keeps the other. Turning the socket's messages into an Effect `Stream` makes the handler a pipeline: here every message is echoed back. For state shared between sockets, see the chat example with Durable Objects. |

## Observability

| Example | What it shows |
| --- | --- |
| [Structured logging](structured-logging.ts) | Workers Logs index JSON log lines, so structured logs are searchable by field. Effect's logger writes one JSON object per line when the layer swaps in `Logger.consoleJson`; annotations and spans become fields, so every line of a request carries its request id without passing it around. |

## Web standard APIs

| Example | What it shows |
| --- | --- |
| [Parse URLs and match routes with URLPattern](url-pattern.ts) | `URL` parses and edits URLs, and `URLPattern` (built into Workers) matches them against route patterns. Pattern groups are strings; decode them with a Schema to get typed values, and use `Option` for a match that may not happen. |
