# flareosaur

The [Deno standard library](https://github.com/denoland/std), ported to run on
Cloudflare Workers without `nodejs_compat`.

## Why

On 9 October 2026 the Deno team
[joined Cloudflare](https://blog.cloudflare.com/deno-joins-cloudflare/), and
workerd is set to become the runtime the Workers programming model is
self-hosted on. Most of `@std` is plain web-standard TypeScript that already
fits that runtime. This repo collects those packages under the `@flareosaur/*`
scope and checks they work in workerd with no compatibility flags.

## Packages

| Package                       | Notes                                              |
| ----------------------------- | -------------------------------------------------- |
| `@flareosaur/assert`          |                                                    |
| `@flareosaur/async`           |                                                    |
| `@flareosaur/bytes`           |                                                    |
| `@flareosaur/cache`           |                                                    |
| `@flareosaur/collections`     |                                                    |
| `@flareosaur/crypto`          | Wasm is loaded as a `.wasm` module import          |
| `@flareosaur/csv`             |                                                    |
| `@flareosaur/data-structures` |                                                    |
| `@flareosaur/datetime`        |                                                    |
| `@flareosaur/dotenv`          | No `load()`; parse a string instead                |
| `@flareosaur/encoding`        |                                                    |
| `@flareosaur/fmt`             |                                                    |
| `@flareosaur/front-matter`    |                                                    |
| `@flareosaur/html`            |                                                    |
| `@flareosaur/http`            | No file server                                     |
| `@flareosaur/json`            |                                                    |
| `@flareosaur/jsonc`           |                                                    |
| `@flareosaur/media-types`     |                                                    |
| `@flareosaur/path`            |                                                    |
| `@flareosaur/regexp`          |                                                    |
| `@flareosaur/semver`          |                                                    |
| `@flareosaur/streams`         |                                                    |
| `@flareosaur/testing`         | `mock`, `time` and `types` only; no `bdd`/`snapshot` |
| `@flareosaur/text`            |                                                    |
| `@flareosaur/toml`            |                                                    |
| `@flareosaur/ulid`            |                                                    |
| `@flareosaur/uuid`            |                                                    |
| `@flareosaur/yaml`            |                                                    |

Packages that are Deno-runtime specific (`fs`, `cli`, `log`, `io`, `net`, …)
are left out. Each package keeps its upstream API, so docs on
[jsr.io/@std](https://jsr.io/@std) apply after swapping the scope.

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

`@flareosaur/crypto` imports a `.wasm` file. Wrangler and
`@cloudflare/vite-plugin` handle that out of the box. For TypeScript, include
[`types/wasm.d.ts`](types/wasm.d.ts) or an equivalent `declare module "*.wasm"`.

## Development

```sh
npm install
npm run check   # type-check every package against @cloudflare/workers-types
npm test        # run the upstream tests inside workerd (Miniflare)
```

### Syncing with upstream

The code is a mechanical copy of `denoland/std`. Don't edit package files by
hand; re-run the port instead:

```sh
git clone https://github.com/denoland/std ../std
npm run port            # or: node scripts/port.mjs path/to/std
```

[`scripts/port.mjs`](scripts/port.mjs) copies the selected packages, drops
files that need Deno or Node APIs, renames `@std/*` to `@flareosaur/*`,
externalizes the crypto wasm and applies any `patches/*.patch`. The upstream
commit it was ported from is recorded in [`UPSTREAM`](UPSTREAM).

## License

MIT, same as upstream. See [LICENSE](LICENSE).
