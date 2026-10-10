# flareosaur

The most used parts of the [Deno standard library](https://github.com/denoland/std),
ported to run on Cloudflare Workers without `nodejs_compat`.

## Why

On 9 October 2026 the Deno team
[joined Cloudflare](https://blog.cloudflare.com/deno-joins-cloudflare/), and
workerd is set to become the runtime the Workers programming model is
self-hosted on. Most of `@std` is plain web-standard TypeScript that already
fits that runtime, but it falls back to `Deno.*` or `node:*` in places and is
only tested on Deno, Node and Bun. This repo collects the packages that make
sense on the edge under the `@flareosaur/*` scope, fixes what breaks on
workerd, and runs std's own tests inside workerd with no compatibility flags.

Ported from the std commit in [`UPSTREAM`](UPSTREAM).

## Packages

Each package keeps its upstream API, so the docs on
[jsr.io/@std](https://jsr.io/@std) apply after swapping the scope.

| Package                       | Notes                                                     |
| ----------------------------- | --------------------------------------------------------- |
| `@flareosaur/assert`          | Failure diffs render as in Deno                           |
| `@flareosaur/async`           | `delay({ persistent: false })` is Deno-only               |
| `@flareosaur/bytes`           |                                                           |
| `@flareosaur/cache`           |                                                           |
| `@flareosaur/collections`     |                                                           |
| `@flareosaur/crypto`          | Wasm is loaded as a `.wasm` module import                 |
| `@flareosaur/csv`             |                                                           |
| `@flareosaur/data-structures` |                                                           |
| `@flareosaur/datetime`        |                                                           |
| `@flareosaur/dotenv`          | No `load()`; parse a string instead                       |
| `@flareosaur/encoding`        |                                                           |
| `@flareosaur/fmt`             | `printf` writes to `console.log`                          |
| `@flareosaur/front-matter`    |                                                           |
| `@flareosaur/html`            |                                                           |
| `@flareosaur/http`            | No file server; the router passes `env` and `ctx` through |
| `@flareosaur/json`            |                                                           |
| `@flareosaur/jsonc`           |                                                           |
| `@flareosaur/media-types`     |                                                           |
| `@flareosaur/path`            | `resolve()` of a relative path throws: there is no cwd    |
| `@flareosaur/regexp`          |                                                           |
| `@flareosaur/semver`          |                                                           |
| `@flareosaur/streams`         |                                                           |
| `@flareosaur/testing`         | `mock`, `time` and `types` only; no `bdd`/`snapshot`      |
| `@flareosaur/text`            |                                                           |
| `@flareosaur/toml`            |                                                           |
| `@flareosaur/ulid`            |                                                           |
| `@flareosaur/uuid`            |                                                           |
| `@flareosaur/yaml`            |                                                           |

`@flareosaur/internal` comes along as a dependency and adds `./inspect`.

Left out: `fs`, `io`, `cli`, `net`, `tar` and `log` (filesystem, stdio,
sockets), `expect` and `webgpu`, and the less used `cbor`, `ini`, `math`,
`msgpack`, `random` and `xml`.

## Usage

```ts
import { encodeBase64 } from "@flareosaur/encoding";
import { crypto } from "@flareosaur/crypto";

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
import { route } from "@flareosaur/http/unstable-route";

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

`@flareosaur/crypto` imports a `.wasm` file. Wrangler and
`@cloudflare/vite-plugin` handle that out of the box. For TypeScript, include
[`types/wasm.d.ts`](types/wasm.d.ts) or an equivalent `declare module "*.wasm"`.

Nothing is published yet. The plan is JSR, which wrangler projects can use
through `npx jsr add`. Doc comments are std's, so some examples still show
`Deno.serve` or `Deno.readTextFile`.

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
- **streams, http**: workarounds for the workerd behaviour below.

### workerd stream differences

These showed up as hangs or errors in std's tests. Each is worked around in the
ported code and is worth reporting to workerd.

1. When a BYOB read ends because the stream closed, the empty view comes back
   at `byteOffset = offset + length` instead of `offset`.
   `CappedDelimiterStream` trusted that offset and looped until it ran out of
   memory.
2. After a BYOB read transfers a pull request's buffer, `byobRequest.view` is a
   detached 0-byte view, and `respondWithNewView()` rejects the filled view
   with "Too many bytes". Hit by `FormDataEncoderStream`.
3. An error thrown in a transformer's `start()` is not rethrown from the
   `TransformStream` constructor (`ByteSliceStream` argument validation).
4. A stream starts pulling before a synchronous `cancel()` gets in, so the
   source is still locked and `stream.cancel()` rejects
   (`concatReadableStreams`).

Not a bug but stricter than Deno: `respond(0)` on an open byte stream throws,
as the spec says. `FormDataEncoderStream` now skips empty chunks.

## Development

```sh
npm install
npm run check   # deno check every module against the web platform libs only
npm test        # run the upstream tests inside workerd (Miniflare)
```

`check` leaves the Deno namespace out, so any `Deno.*` reference fails to
compile. `test` bundles each package's std tests with esbuild and runs them in
workerd with no compatibility flags. `Deno.test` and `Deno` reads of a
package's own `testdata/` map to a small shim. Tests that need a real
filesystem, subprocesses or Node are listed with a reason in
[`scripts/skip.json`](scripts/skip.json). Run one package with
`npm test -- http`, one file with `npm test -- http/cookie_test.ts`.

Current result: 3485 passed, 0 failed, 49 skipped, 111 ignored upstream.

### Syncing with upstream

```sh
git clone https://github.com/denoland/std ../std
npm run port            # or: node scripts/port.mjs path/to/std
```

[`scripts/port.mjs`](scripts/port.mjs) copies the selected packages, drops
files that need Deno or Node APIs, renames `@std/*` to `@flareosaur/*`,
externalizes the crypto wasm and applies `patches/*.patch`. The upstream
commit it was ported from is recorded in [`UPSTREAM`](UPSTREAM).

To change an edge fix, edit the ported files, then run `npm run patch` to
regenerate `patches/edge.patch` from a fresh unpatched port. If the patch stops
applying after an upstream bump, port with `--no-patches`, redo the edits and
regenerate.

## License

MIT, same as upstream. See [LICENSE](LICENSE).
