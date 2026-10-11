<p align="center">
  <img src="assets/logo.svg" width="160" alt="flareosaur: an orange dinosaur with flames along its back">
</p>

# flareosaur

The Deno standard library's surface, rebuilt on [Effect](https://effect.website)
v4, plus the Cloudflare Workers runtime as Effect services, plus the
[Deno examples](https://docs.deno.com/examples/) ported to Workers. Everything
runs on workerd with no `nodejs_compat`.

## Why

On 9 October 2026 the Deno team
[joined Cloudflare](https://blog.cloudflare.com/deno-joins-cloudflare/). Deno
is easy to build with because of three layers: a runtime with a server, KV,
cron and queues built in; a reviewed standard library; and hundreds of small,
runnable examples. Workers has the runtime, with better primitives, but no
standard library and no examples that tie it together, so the default is npm
and `nodejs_compat`.

Effect already is most of a standard library, in one package with no
dependencies. flareosaur fills in the rest:

- **std on Effect.** Each `@std` package's API, built on Effect: where Effect
  covers a feature (retries, caching, cron, Base64, HTTP, streams, paths), the
  package uses Effect; where it doesn't (YAML 1.2, TOML, streaming CSV,
  semver, negotiation, signed cookies, ...), std's code stays and gets an
  Effect API with typed errors and Schema codecs.
- **The Workers runtime as Effect services.** `workers` does for Workers what
  `Deno.serve`, Deno KV, `Deno.cron` and Deno Queues do for Deno.
- **Examples.** [`examples/`](examples/README.md): the Deno examples as
  Workers, plus network and email tools (DNS, DMARC, SPF, RDAP, SMTP, IPv6,
  ...), each checked in workerd. Live at
  [flareosaur.mikepage.nl](https://flareosaur.mikepage.nl).

## Packages

Published as [`@mikepage/flareosaur`](https://jsr.io/@mikepage/flareosaur), one
package with a subpath per std package: `@std/yaml` becomes
`@mikepage/flareosaur/yaml`. Every public module imports `effect`.

| Subpath | What it is |
| --- | --- |
| `workers` | `Worker.make` (fetch, scheduled, queue), `Env` and `Config` from bindings, KV as `KeyValueStore`, R2 as `Stream`s, Schema-typed Queues, Cron dispatch, Cache API, Durable Objects runner |
| `assert` | std's assertions throwing a `Schema.TaggedError`, Deno-style diffs, `Equal` support, and Effect assertions (`assertSucceeds`, `assertFailsWithTag`, ...) |
| `testing` | `describe` / `it.effect` tests that run inside workerd, mocks, test clock helpers |
| `async` | std's helpers (retry, deadline, debounce, pooledMap, ...) on `Schedule`, fibers and `Semaphore` |
| `bytes`, `collections`, `data-structures`, `text`, `regexp` | std's utilities with `Option`, `Order` and pipeable APIs, delegating to Effect's `Array`, `Record`, `String` where they match |
| `cache` | LRU and TTL caches and `memoize` on Effect's `Cache` |
| `crypto` | A Web Crypto layer for Effect's `Crypto`, std's WebAssembly digests (BLAKE3, SHA-3, ...), AES-GCM, HMAC, PBKDF2, HKDF |
| `uuid`, `ulid` | Generation from `Clock` and `Crypto` (deterministic in tests), branded Schemas |
| `datetime` | Pattern-based `format` and `parse` on Effect's `DateTime` |
| `encoding` | Effect's Base64/Hex plus Base32, Base58, Ascii85, Varint, with streams |
| `yaml`, `toml`, `jsonc`, `csv`, `json`, `front-matter`, `dotenv` | Parsers and stringifiers as Effects, Schema codecs, streaming CSV and JSON, `.env` text as a `ConfigProvider` |
| `http`, `media-types` | Negotiation, user agents, cache control, structured fields, signed cookies, message signatures, problem details, ETags, SSE, on `effect/http` |
| `semver` | `SemVer` with `Order`, ranges, `Result`-returning parsers |
| `streams`, `path`, `html`, `fmt` | Stream operators and Web Streams interop, POSIX/Windows paths, escaping, formatting |
| `internal` | Deno-style `inspect` for any runtime, with `Redacted` support |

std's original code lives in `<pkg>/_std/`, vendored from the std commit in
[`UPSTREAM`](UPSTREAM), with the edits in
[`patches/edge.patch`](patches/edge.patch).

## Usage

```sh
npx jsr add @mikepage/flareosaur effect
```

```ts
import { Effect, Option, Schema } from "effect"
import * as Kv from "@mikepage/flareosaur/workers/kv"
import * as Worker from "@mikepage/flareosaur/workers/worker"
import * as Yaml from "@mikepage/flareosaur/yaml"

const Config = Schema.Struct({ name: Schema.String, port: Schema.Int })

export default Worker.make({
  layer: Kv.layer("CONFIG"),
  fetch: () =>
    Effect.gen(function*() {
      const kv = yield* Kv.Kv
      const text = yield* kv.get("config.yaml")
      const config = yield* Schema.decodeEffect(Yaml.schema(Config))(Option.getOrElse(text, () => ""))
      return Response.json(config)
    }),
})
```

`crypto` imports a `.wasm` file. Wrangler and `@cloudflare/vite-plugin` handle
that out of the box. For TypeScript, include [`types/wasm.d.ts`](types/wasm.d.ts).

## Things we found on workerd

- **Stream bugs in workerd**, worked around in the vendored std code:
  1. When a BYOB read ends because the stream closed, the empty view comes back
     at `byteOffset = offset + length` instead of `offset`.
  2. After a BYOB read transfers a pull request's buffer, `byobRequest.view` is
     a detached 0-byte view, and `respondWithNewView()` rejects the filled view.
  3. An error thrown in a transformer's `start()` is not rethrown from the
     `TransformStream` constructor.
  4. A stream starts pulling before a synchronous `cancel()`, so the source is
     still locked when it gets cancelled.
- **Effect on Workers without `nodejs_compat`** works, with two exceptions: the
  `effect/testing` barrel imports `node:util` (import `effect/testing/TestClock`
  directly), and Effect's default `Path.layer` reads `process.cwd()` (use
  `path`'s `layer`).
- **No randomness, timers or I/O in global scope.** Generate ids inside
  handlers, not when the module loads.

## Development

```sh
npm install
npm run check      # exports, public-module lint (Effect-only, no Deno/Node), tsc
npm test           # every package's tests inside workerd (Miniflare)
npm run examples   # every example against its documented responses
```

The tooling is an `effect/cli` app in [`scripts/cli.ts`](scripts/cli.ts). Run
one package with `npm test -- yaml`, one file with
`npm test -- yaml/yaml.test.ts`, one example with
`npm run examples -- kv`. See [`CLAUDE.md`](CLAUDE.md) for the conventions a
package follows.

### The examples site

[`site/worker.ts`](site/worker.ts) serves every example that needs no storage
bindings at `/<example>/` on flareosaur.mikepage.nl, with an index at `/` and a
per-IP rate limit. `npm run site` regenerates the list
(`site/examples.generated.ts`), `npm run site:dev` runs it locally and
`npm run site:deploy` deploys it.

### Syncing with upstream std

```sh
npm run port -- ../std    # re-vendor std into <pkg>/_std and apply the patch
npm run patch -- ../std   # after editing _std: regenerate patches/edge.patch
```

### Releasing

Versions are CalVer, `YYYYMMDD.0.N`, with N counting releases that day from
1. Set `version` in `deno.json` and push to `main`. CI runs the checks, tests
and examples, then publishes to JSR with GitHub OIDC. Pushes without a version
bump publish nothing.

## License

MIT, same as upstream. See [LICENSE](LICENSE).
