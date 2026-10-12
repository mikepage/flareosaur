<p align="center">
  <img src="assets/logo.svg" width="160" alt="flareosaur: an orange dinosaur with flames along its back">
</p>

# flareosaur

The most used parts of the
[Deno standard library](https://github.com/denoland/std), ported to run on
Cloudflare Workers without `nodejs_compat`. Plus the
[Deno examples](https://docs.deno.com/examples/), rewritten as plain Workers.

## Why

On 9 October 2026 the Deno team
[joined Cloudflare](https://blog.cloudflare.com/deno-joins-cloudflare/). Deno
was easy to build with because it came with batteries: a reviewed standard
library and hundreds of small, runnable examples. Workers has a better runtime
but ships neither, so the default is npm and `nodejs_compat`.

Most of what a Worker needs is already in the platform, as web APIs and
bindings:

| Job              | Platform API                                                      |
| ---------------- | ----------------------------------------------------------------- |
| Routing          | `URLPattern`                                                      |
| HTTP             | `fetch`, `AbortSignal.timeout`                                    |
| HTML             | `HTMLRewriter`                                                    |
| TCP              | `cloudflare:sockets`                                              |
| Crypto           | `crypto.subtle`                                                   |
| Formatting       | `Intl`                                                            |
| Streams          | Web Streams, `CompressionStream`, `TextDecoderStream`             |
| Storage and jobs | KV, R2, D1, Queues, Cron Triggers, rate limiting, Durable Objects |

flareosaur adds the rest from Deno's std: YAML, TOML, CSV, semver, cookies,
negotiation, retries, BLAKE3, and so on. Most of `@std` is plain web-standard
TypeScript that already fits workerd, but it falls back to `Deno.*` or `node:*`
in places and is only tested on Deno, Node and Bun. This repo collects the
packages that make sense on the edge into one JSR package, fixes what breaks on
workerd, and runs std's own tests inside workerd with no compatibility flags.

Ported from the std commit in [`UPSTREAM`](UPSTREAM).

## Packages

Published as [`@mikepage/flareosaur`](https://jsr.io/@mikepage/flareosaur). Each
std package is a subpath with its upstream API and exports: `@std/http/cookie`
becomes `@mikepage/flareosaur/http/cookie`. The docs on
[jsr.io/@std](https://jsr.io/@std) apply after swapping the prefix.

| Subpath           | Notes                                                     |
| ----------------- | --------------------------------------------------------- |
| `assert`          | Failure diffs render as in Deno                           |
| `async`           | `delay({ persistent: false })` is Deno-only               |
| `bytes`           |                                                           |
| `cache`           |                                                           |
| `collections`     |                                                           |
| `crypto`          | Wasm is loaded as a `.wasm` module import                 |
| `csv`             |                                                           |
| `data-structures` |                                                           |
| `datetime`        |                                                           |
| `dotenv`          | No `load()`; parse a string instead                       |
| `encoding`        |                                                           |
| `fmt`             | `printf` writes to `console.log`                          |
| `front-matter`    |                                                           |
| `html`            |                                                           |
| `http`            | No file server; the router passes `env` and `ctx` through |
| `json`            |                                                           |
| `jsonc`           |                                                           |
| `media-types`     |                                                           |
| `path`            | `resolve()` of a relative path throws: there is no cwd    |
| `regexp`          |                                                           |
| `semver`          |                                                           |
| `streams`         |                                                           |
| `testing`         | `mock`, `time` and `types` only; no `bdd`/`snapshot`      |
| `text`            |                                                           |
| `toml`            |                                                           |
| `ulid`            |                                                           |
| `uuid`            |                                                           |
| `yaml`            |                                                           |

`internal` comes along as a dependency and adds `internal/inspect`.

Left out: `fs`, `io`, `cli`, `net`, `tar` and `log` (filesystem, stdio,
sockets), `expect` and `webgpu`, and the less used `cbor`, `ini`, `math`,
`msgpack`, `random` and `xml`.

There are no wrappers for KV, R2, Queues, Cron or Durable Objects. The bindings
are already small, typed, promise-based APIs. The [examples](examples/README.md)
show them directly.

## Usage

```sh
npx jsr add @mikepage/flareosaur
```

```ts
import { encodeBase64 } from "@mikepage/flareosaur/encoding";
import { crypto } from "@mikepage/flareosaur/crypto";

export default {
  async fetch(req: Request) {
    const body = new Uint8Array(await req.arrayBuffer());
    const digest = await crypto.subtle.digest("BLAKE3", body);
    return new Response(encodeBase64(digest));
  },
};
```

The router hands the rest of the `fetch` arguments to each handler:

```ts
import { route } from "@mikepage/flareosaur/http/unstable-route";

export default {
  fetch: route<[Env, ExecutionContext]>([
    {
      pattern: new URLPattern({ pathname: "/hello/:name" }),
      handler: (_req, params, env) =>
        new Response(`${env.GREETING}, ${params.pathname.groups.name}`),
    },
  ], () => new Response("Not found", { status: 404 })),
};
```

`crypto` imports a `.wasm` file. Wrangler and `@cloudflare/vite-plugin` handle
that out of the box. For TypeScript, include
[`types/wasm.d.ts`](types/wasm.d.ts) or an equivalent `declare module "*.wasm"`.

Imports inside the package are relative paths, so it bundles with no import map
or aliases. Doc comments are std's, so some examples still show `Deno.serve` or
`Deno.readTextFile`.

## Examples

[`examples/`](examples/README.md) has the Deno examples as Workers: timeouts,
retries, routing, cookies, streaming, WebSockets, KV, R2, D1, Queues, Cron,
Durable Objects, CSV, YAML, hashing, an MCP server and more. Each is one file
with a commented walkthrough. They use web APIs, the bindings and this package,
and nothing else.

```sh
npx wrangler dev examples/hello-world.ts
```

## Changes from std

The port is mechanical, plus the edits in
[`patches/edge.patch`](patches/edge.patch):

- **crypto**: std inlines the wasm as base64 and compiles it with
  `new WebAssembly.Module(bytes)`, which Workers forbid. The port writes it out
  as `deno_std_wasm_crypto.wasm` and imports it as a module.
- **internal/format**: without `Deno.inspect` or `node:util`, std printed values
  as JSON, so `assertEquals` failures were hard to read.
  [`internal/inspect.ts`](internal/inspect.ts) ports Deno's layout rules and is
  the fallback. `fmt/printf` uses it for `%v`, `%i` and `%I`.
- **http**: no `file-server`. `unstable-route` handlers take
  `(request, params, ...args)` instead of `Deno.ServeHandlerInfo`.
- **dotenv**: no `load()`, `loadSync()` or `./load`. `parse()` no longer falls
  back to `Deno.env` when expanding `${VAR}`.
- **streams, http**: workarounds for four workerd stream bugs that std's tests
  turned up (BYOB reads and `TransformStream` start errors). See the comments in
  the patch.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for running the tests and examples,
syncing with upstream std and releasing.

## License

MIT, same as upstream. See [LICENSE](LICENSE).
