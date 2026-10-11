# flareosaur examples

The [Deno examples](https://docs.deno.com/examples/), rewritten with Effect for Cloudflare Workers.
Each file is a Worker with a commented walkthrough. No `nodejs_compat`.

Run one with `npx wrangler dev examples/<name>.ts`. `npm run examples` checks them all in workerd.

## Basics

- [Add a timeout to any effect](timeout-any-effect.ts)
- [Check if two values are deeply equal](deep-equal.ts)
- [Generate seeded random numbers](seeded-random.ts)
- [Hello World](hello-world.ts)
- [Set timeouts and intervals with schedules](repeat-with-schedules.ts)
- [Sleep and delay execution](sleep-and-delay.ts)
- [Structured logging](structured-logging.ts)
- [Cancel async work with interruption](cancel-with-interruption.ts) · intermediate
- [Memoize an expensive function](memoize.ts) · intermediate
- [Retry with exponential backoff](exponential-backoff.ts) · intermediate
- [Run tasks with a concurrency limit](concurrency-limit.ts) · intermediate

## HTTP

- [Cookies](http-server-cookies.ts)
- [CORS](http-server-cors.ts)
- [Health checks](http-server-health-checks.ts)
- [Make HTTP requests](http-requests.ts)
- [Routing](http-server-routing.ts)
- [Streaming responses](http-server-streaming.ts)
- [Validate JSON bodies](http-server-validate-json.ts)
- [Basic authentication](http-server-basic-auth.ts) · intermediate
- [Caching headers and ETags](http-server-etag.ts) · intermediate
- [Content negotiation](http-server-negotiation.ts) · intermediate
- [Errors as problem details](http-server-problem-details.ts) · intermediate
- [Paginating results](http-server-pagination.ts) · intermediate
- [Request timeouts](http-server-request-timeouts.ts) · intermediate
- [Server-sent events](http-server-sse.ts) · intermediate
- [Sessions with signed cookies](http-server-signed-cookies.ts) · intermediate
- [WebSockets](websocket-echo.ts) · intermediate
- [Rate limiting](http-server-rate-limit.ts) · advanced

## Cloudflare

- [Cron Triggers](cron.ts)
- [Environment variables and secrets](environment-variables.ts)
- [R2: read and write files](r2-files.ts)
- [Workers KV](kv.ts)
- [Cache API](cache-api.ts) · intermediate
- [D1: SQL](d1-sql.ts) · intermediate
- [Durable Objects: a counter](durable-object-counter.ts) · intermediate
- [Queues: offload work](queues.ts) · intermediate
- [WebSocket chat with Durable Objects](websocket-chat.ts) · advanced

## Data formats

- [Compress and decompress data](compress-decompress.ts)
- [Extract front matter from Markdown](front-matter.ts)
- [Hex, base64, base32 and base58 encoding](hex-base64-encoding.ts)
- [Parse and serialize TOML and YAML](toml-yaml-config.ts)
- [Read a stream line by line](read-lines.ts)
- [Parse and serialize CSV, also as streams](csv.ts) · intermediate
- [Stream JSON Lines data](json-lines.ts) · intermediate

## Standard library

- [Escape HTML, CSS and JavaScript](escape-html.ts)
- [Parse and compare semver versions](semver-versions.ts)
- [Parse URLs and match routes with URLPattern](url-pattern.ts)
- [Parse, format and compute with dates](dates.ts)
- [Path operations](path-operations.ts)
- [Read configuration from .env text](dotenv-config.ts)

## Cryptography

- [Generate and validate UUIDs and ULIDs](uuids-and-ulids.ts)
- [Hash data](hashing.ts)
- [AES encryption and decryption](aes-encryption.ts) · intermediate
- [Hashing and verifying passwords](password-hashing.ts) · intermediate
- [Verify webhook signatures](webhook-signatures.ts) · intermediate

## AI

- [Connect to Claude with Effect AI](anthropic-chat.ts)
- [Build an MCP server](mcp-server.ts) · intermediate
