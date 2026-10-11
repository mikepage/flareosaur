# flareosaur

The Deno standard library's surface, rebuilt on Effect v4, running on
Cloudflare Workers with no `nodejs_compat`. Published to JSR as
`@mikepage/flareosaur` (one package, a subpath per std package).

## Layout

- `<pkg>/mod.ts` and `<pkg>/<Name>.ts`: the public API. `deno.json` exports
  are generated from these (`npm run exports`): `mod.ts` is `./<pkg>`,
  `<Name>.ts` is `./<pkg>/<name>` (kebab case; `data_structures` becomes
  `data-structures`).
- `<pkg>/_std/`: std's code, vendored by `npm run port` from a denoland/std
  checkout. Internal. Never edit it directly without regenerating the patch
  (`npm run patch`); edits live in `patches/edge.patch`. Delete a package's
  `_std/` when its public API no longer needs it; the port then stops
  vendoring it (unless other vendored code imports it).
- `<pkg>/*.test.ts`: Effect tests for the public API.
- `scripts/`: the repo CLI, built with `effect/cli` and run with Node
  (`node scripts/cli.ts <command>`, or the npm scripts).

## Rules for public modules (enforced by `npm run check`)

1. Built on Effect: every public module imports `effect` (or `effect/*`),
   unless it only re-exports other public modules of its package.
2. Workers only: no `Deno.*`, no `node:` imports, nothing that needs
   `nodejs_compat`. Do not import the `effect/testing` barrel or
   `effect/http-api` Scalar, which import `node:` modules; use deep imports
   such as `effect/testing/TestClock`.
3. Other packages are used through their public modules
   (`../yaml/mod.ts`), never their `_std/`. A package may import its own
   `./_std/`.

## How to rebuild a package on Effect

- Prefer Effect's own modules where they cover the feature (`effect`
  `Array`, `Record`, `String`, `Schedule`, `Cache`, `Cron`, `DateTime`,
  `Duration`, `Stream`, `Schema`, `Random`, `RegExp`, `Path`; `effect/http`;
  `effect/encoding` Base64/Hex/Yaml/Toml/Ini/Ndjson/Sse). Delegate to them,
  and only add what Effect lacks, written in Effect's style.
- Keep std's code (`_std/`) for what Effect lacks (parsers, stringifiers,
  algorithms) and expose it through an Effect API.
- Effect style (see `node_modules/effect/AGENTS.md` and `ai-docs/`):
  - Fallible operations return `Effect` (or `Result` when synchronous and
    hot), failing with a `Schema.TaggedError` named `<Thing>Error`, with a
    `message` and, where useful, a `cause: Schema.Defect()`.
  - Write effectful functions with `Effect.fnUntraced` (library code).
  - Parsing and validation of untrusted data goes through `Schema`. Offer
    Schema codecs where a format maps to values, e.g. `Yaml.schema(S)` that
    decodes a YAML string into `S`.
  - Pure helpers stay pure but use Effect data types: `Option` instead of
    `undefined`/`-1`, `Result` for fallible sync code, `Order` and
    `Equivalence` instances, `Function.dual` for pipeable data-first/last
    APIs, `Duration` for time.
  - Long-running or streaming work is a `Stream` or a `Channel`.
  - Services (`Context.Service`) with a `layer` for anything with
    configuration or a platform dependency (e.g. Web Crypto).
- Module docs: every public module starts with a JSDoc block ending in
  `@module`, explaining what it offers over plain Effect, with an example.
  Every export has a JSDoc comment.
- Tests: `describe` / `it` / `it.effect` / `it.live` from
  `../testing/mod.ts`, assertions from `../assert/mod.ts`. They run inside
  workerd: `npm test -- <pkg>` or `npm test -- <pkg>/<file>.test.ts`.
  Cover every public function; port the meaningful cases from std's tests.
- Keep std's tests in `_std/` passing while `_std/` exists.

## JSR: no slow types

JSR rejects "slow types" (public API whose type must be inferred) and, with
`--allow-slow-types`, turns them into `any` in the npm declarations Workers
users get through `npx jsr add`. So every export has an explicit type
(`npm run check -- --jsr` runs the publish dry run and fails on them):

1. Classes may not extend a call. Give the call a typed base constant named
   `<Name>Base`, then extend it. The type is the call's return type:
   `Schema.Class<Self, Schema.TaggedStruct<"Tag", { ...fields }>,
   Cause.YieldableError>` for `Schema.TaggedError`, `Schema.Class<Self,
   Schema.Struct<{ ...fields }>, {}>` for `Schema.Class`, and
   `Context.ServiceClass<Self, "key", Shape>` for `Context.Service`. Field
   types are the Schema interfaces (`Schema.String`, `Schema.Defect`,
   `Schema.optional<Schema.String>`, `typeof OtherSchema`, ...):

   ```ts
   const YamlErrorBase: Schema.Class<
     YamlError,
     Schema.TaggedStruct<"YamlError", {
       readonly message: Schema.String
       readonly cause: Schema.Defect
     }>,
     Cause.YieldableError
   > = Schema.TaggedError<YamlError>()("YamlError", { message: Schema.String, cause: Schema.Defect() })

   /** doc */
   export class YamlError extends YamlErrorBase {}
   ```

2. Exported constants and functions carry their types: Schemas as
   `Schema.Struct<{...}>`, `Schema.brand<Schema.String, "Uuid">`, codecs as
   `Schema.decodeTo<S, Schema.String>`; `Effect.fnUntraced(...)` and
   point-free values (`encodeBlocks(5, encode)`) as a function type; every
   function with a return type. Refer to other schemas with `typeof X` rather
   than repeating their types. Never `any` in a public signature.

## Commands

- `npm run check`: regenerate exports, lint public modules, `tsc`. Add
  `-- --jsr` to also run `jsr publish --dry-run` (slow types).
- `npm test [-- <pkg>[/<file>]]`: run tests in workerd (Miniflare).
- `npm run port -- ../std`, `npm run patch -- ../std`: vendor std, regenerate
  the patch.

Commit messages: Conventional Commits, ending with the Co-Authored-By line.
