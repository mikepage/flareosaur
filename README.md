# flareosaur

The most used parts of the
[Deno standard library](https://github.com/denoland/std), ported to run on
Cloudflare Workers with **no** `nodejs_compat` flag.

Deno [joined Cloudflare](https://blog.cloudflare.com/deno-joins-cloudflare/).
std is mostly web-platform code already, but it falls back to `Deno.*` or
`node:*` in places, and it is only tested on Deno, Node and Bun. flareosaur
keeps the packages that make sense on the edge, removes what needs a filesystem
or process, fixes what breaks on workerd, and runs std's own test suite inside
workerd.

Ported from `denoland/std@f834d022` (see [`UPSTREAM`](UPSTREAM)).

## Packages

Import as `@flareosaur/<name>`, with the same exports as `@std/<name>`.

| Package           | Notes                                                            |
| ----------------- | ---------------------------------------------------------------- |
| `assert`          | Diffs render like in Deno (see `internal/inspect`)               |
| `async`           | `delay({ persistent: false })` is Deno-only and logs an error    |
| `bytes`           |                                                                  |
| `cache`           |                                                                  |
| `collections`     |                                                                  |
| `crypto`          | Non-WebCrypto digests (BLAKE3, etc.) use a `.wasm` module import |
| `csv`             |                                                                  |
| `data_structures` |                                                                  |
| `datetime`        |                                                                  |
| `dotenv`          | `parse` and `stringify` only                                     |
| `encoding`        |                                                                  |
| `fmt`             | `printf` writes to `console.log`                                 |
| `front_matter`    |                                                                  |
| `html`            |                                                                  |
| `http`            | No file server. The router passes `env` and `ctx` through        |
| `internal`        | Adds `./inspect`, a `Deno.inspect` stand-in                      |
| `json`            |                                                                  |
| `jsonc`           |                                                                  |
| `media_types`     |                                                                  |
| `path`            | `resolve()` of a relative path throws: there is no cwd           |
| `regexp`          |                                                                  |
| `semver`          |                                                                  |
| `streams`         |                                                                  |
| `testing`         | `mock`, `time`, `types` only                                     |
| `text`            |                                                                  |
| `toml`            |                                                                  |
| `ulid`            |                                                                  |
| `uuid`            |                                                                  |
| `yaml`            |                                                                  |

Not ported: `fs`, `io`, `cli`, `net`, `tar` (filesystem, stdio, sockets),
`testing/bdd` and `testing/snapshot` (built on `Deno.test` and files), `expect`,
`webgpu`, and the less used `cbor`, `ini`, `math`, `msgpack`, `random`, `xml`.

## Changes from std

All edits are in [`patches/edge.patch`](patches/edge.patch).

- **crypto**: the wasm was inlined as base64 and compiled with
  `new WebAssembly.Module(bytes)`, which Workers forbid. It now ships as
  `deno_std_wasm_crypto.wasm` and is imported as a module, which wrangler and
  `@cloudflare/vite-plugin` bundle as a compiled Wasm module.
- **internal/format**: without `Deno.inspect` or `node:util`, std printed values
  as JSON, so `assertEquals` failures were hard to read. `internal/inspect.ts`
  ports Deno's layout rules and is used as the fallback. `fmt/printf` uses it
  for `%v`, `%i` and `%I`.
- **http**: dropped `file-server`. `unstable-route` handlers take
  `(request, params, ...args)`, so a Worker gets `env` and `ctx`:

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

- **dotenv**: removed `load()`, `loadSync()` and `./load`. `parse()` no longer
  falls back to `Deno.env` when expanding `${VAR}`.
- **streams, http**: workarounds for workerd stream behaviour, below.

### workerd stream differences

These showed up as hangs or errors in std's tests. Each is worked around in the
std code and worth reporting to workerd.

1. When a BYOB read ends because the stream closed, the empty view comes back at
   `byteOffset = offset + length` of the request instead of `offset`.
   `CappedDelimiterStream` used that offset and looped until it ran out of
   memory.
2. After a BYOB read transfers a pull request's buffer, `byobRequest.view` is a
   detached 0-byte view, and `respondWithNewView()` rejects the filled view with
   "Too many bytes". Hit by `FormDataEncoderStream`.
3. An error thrown in a transformer's `start()` is not rethrown from the
   `TransformStream` constructor (`ByteSliceStream` validation).
4. A stream starts pulling before a synchronous `cancel()`, so the source is
   still locked and `stream.cancel()` rejects (`concatReadableStreams`).

Not a workerd bug but different from Deno: `respond(0)` on an open byte stream
throws, as the spec requires. `FormDataEncoderStream` now skips empty chunks.

## Using it

Not published yet. The plan is JSR as `@flareosaur/*`, which works with wrangler
through `npx jsr add`. Until then, alias `@flareosaur/*` to this repo in your
bundler.

Doc comments are std's and some examples still use `Deno.serve` or
`Deno.readTextFile`.

## Development

```bash
npm install
```

```bash
npm run check
```

```bash
npm test
```

- `check` runs `deno check` on every module against the web platform libs only,
  so any `Deno.*` reference fails to compile.
- `test` bundles each package's std tests with esbuild and runs them in workerd
  (Miniflare) with no compatibility flags. `Deno.test` and the `Deno` file reads
  of a package's own `testdata/` are mapped to a small shim. Tests that need a
  real filesystem, subprocesses or Node are listed with a reason in
  [`scripts/skip.json`](scripts/skip.json). Run one package with
  `npm test -- http`, one file with `npm test -- http/cookie_test.ts`.

Current result: 3485 passed, 0 failed, 49 skipped, 111 ignored upstream.

### Updating from std

```bash
npm run port -- ../std
```

This copies the packages from a std checkout, renames `@std/` to `@flareosaur/`,
extracts the crypto wasm and applies `patches/edge.patch`. If the patch no
longer applies, port with `--no-patches`, redo the edits, and regenerate the
patch (see the comment at the top of `scripts/port.mjs`).

## License

MIT, same as std. See [LICENSE](LICENSE).
