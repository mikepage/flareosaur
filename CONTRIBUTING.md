# Contributing to flareosaur

## Setup

```sh
npm install
npm run check      # deno check the packages against web libs, tsc the examples against workers-types
npm test           # std's own tests inside workerd (Miniflare)
npm run examples   # every example against the checks in its header
```

`check` leaves the Deno namespace out, so any `Deno.*` reference fails to
compile. It then type-checks the examples the way a Worker sees the package:
through emitted declarations and `@cloudflare/workers-types`.

`test` bundles each package's std tests with esbuild and runs them in workerd
with no compatibility flags. `Deno.test` and `Deno` reads of a package's own
`testdata/` map to a small shim. Tests that need a real filesystem, subprocesses
or Node are listed with a reason in [`scripts/skip.json`](scripts/skip.json).
Run one package with `npm test -- http`, one file with
`npm test -- http/cookie_test.ts`.

Current result: 3485 passed, 0 failed, 49 skipped, 111 ignored upstream.

`examples` bundles each example, loads it into Miniflare with the bindings its
header lists, and runs the header's `@check` requests. Run one with
`npm run examples -- kv`. With no arguments it also regenerates
[`examples/README.md`](examples/README.md).

## Syncing with upstream

```sh
git clone https://github.com/denoland/std ../std
npm run port            # or: node scripts/port.mjs path/to/std
```

[`scripts/port.mjs`](scripts/port.mjs) copies the selected packages, drops files
that need Deno or Node APIs, rewrites imports between packages to relative
paths, generates the `exports` in `deno.json`, externalizes the crypto wasm and
applies `patches/*.patch`. The upstream commit it was ported from is recorded in
[`UPSTREAM`](UPSTREAM).

To change an edge fix, edit the ported files, then run `npm run patch` to
regenerate `patches/edge.patch` from a fresh unpatched port. If the patch stops
applying after an upstream bump, port with `--no-patches`, redo the edits and
regenerate.

## Releasing

Versions are CalVer, `YYYYMMDD.0.N`, with N counting releases that day from 1
(`20261010.0.1`, `20261010.0.2`, …). Set `version` in `deno.json` and push to
`main`. CI runs the checks, tests and examples, then publishes to JSR with
GitHub OIDC. Pushes without a version bump publish nothing.

## Adding an example

An example is one file, `examples/<slug>.ts`: a Worker module with a JSDoc
header. The header's `@check` lines are its test. The syntax is documented at
the top of [`scripts/examples.mjs`](scripts/examples.mjs).

Use web APIs and the Workers bindings first, and `@mikepage/flareosaur/<pkg>`
where std clearly helps. Nothing else. Then run:

```sh
npm run check
npm run examples -- <slug>
npm run examples        # all of them, and regenerate examples/README.md
```

## Commits

[Conventional Commits](https://www.conventionalcommits.org): `feat(http): ...`,
`fix(streams): ...`, `docs: ...`, `chore: release YYYYMMDD.0.N`.
