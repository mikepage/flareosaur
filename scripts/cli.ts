// Copyright 2026 the flareosaur authors. MIT license.
// The repo's command line, built with Effect CLI:
//
//   node scripts/cli.ts port [std]      vendor std code into <dir>/_std
//   node scripts/cli.ts patch [std]     regenerate patches/edge.patch
//   node scripts/cli.ts exports         regenerate the deno.json exports
//   node scripts/cli.ts check           tsc + public module lint
//   node scripts/cli.ts test [target]   run the tests in workerd

import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Console, Effect } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { lint, typecheck, CheckError } from "./Check.ts"
import { generateExports } from "./Exports.ts"
import { makePatch } from "./Patch.ts"
import { port, ROOT } from "./Port.ts"
import { runTests, TestRunError } from "./Test.ts"
import { generateIndex, runExamples, ExampleError } from "./Examples.ts"

const std = Argument.String("std").pipe(
  Argument.withDescription("Path to a denoland/std checkout"),
  Argument.withDefault(`${ROOT}/../std`),
)

const portCommand = Command.make(
  "port",
  {
    std,
    noPatches: Flag.Boolean("no-patches").pipe(
      Flag.withDescription("Skip patches/*.patch"),
      Flag.withDefault(false),
    ),
  },
  Effect.fn(function*({ std, noPatches }) {
    const { packages, rev } = yield* port({ std, out: ROOT, patches: !noPatches })
    yield* Console.log(`vendored ${packages.length} std packages from std@${rev}: ${packages.join(", ")}`)
  }),
).pipe(Command.withDescription("Vendor std code into <dir>/_std and apply the patches"))

const patchCommand = Command.make(
  "patch",
  { std },
  Effect.fn(function*({ std }) {
    yield* Console.log(`wrote patches/edge.patch (${yield* makePatch(std)})`)
  }),
).pipe(Command.withDescription("Regenerate patches/edge.patch from the vendored _std edits"))

const exportsCommand = Command.make(
  "exports",
  {},
  Effect.fn(function*() {
    yield* Console.log(`wrote ${yield* generateExports()} exports to deno.json`)
  }),
).pipe(Command.withDescription("Regenerate the deno.json exports from the public modules"))

const checkCommand = Command.make(
  "check",
  {},
  Effect.fn(function*() {
    yield* generateExports()
    const problems = yield* lint()
    for (const { file, problem } of problems) yield* Console.error(`${file}: ${problem}`)
    const typesOk = yield* typecheck()
    if (problems.length || !typesOk) {
      return yield* new CheckError({ message: `${problems.length} lint problems, types ${typesOk ? "ok" : "failed"}` })
    }
    yield* Console.log("check ok")
  }),
).pipe(Command.withDescription("Type-check and lint the public modules"))

const testCommand = Command.make(
  "test",
  {
    targets: Argument.String("target").pipe(
      Argument.withDescription("A package, or package/file to run one file"),
      Argument.variadic(),
    ),
    verbose: Flag.Boolean("verbose").pipe(Flag.withDefault(false)),
    trace: Flag.Boolean("trace").pipe(Flag.withDescription("Log each test as it starts"), Flag.withDefault(false)),
  },
  Effect.fn(function*({ targets, verbose, trace }) {
    const totals = yield* runTests({ targets, verbose, trace })
    if (totals.fail) return yield* new TestRunError({ message: `${totals.fail} tests failed` })
  }),
).pipe(Command.withDescription("Run the tests in workerd"))

const examplesCommand = Command.make(
  "examples",
  {
    slugs: Argument.String("example").pipe(Argument.withDescription("Examples to run (default: all)"), Argument.variadic()),
  },
  Effect.fn(function*({ slugs }) {
    yield* Console.log(`wrote examples/README.md (${yield* generateIndex()} examples)`)
    const failed = yield* runExamples(slugs)
    if (failed) return yield* new ExampleError({ example: "*", message: `${failed} examples failed` })
  }),
).pipe(Command.withDescription("Check the Workers examples in Miniflare and regenerate their index"))

Command.make("flareosaur").pipe(
  Command.withDescription("Tooling for flareosaur"),
  Command.withSubcommands([portCommand, patchCommand, exportsCommand, checkCommand, testCommand, examplesCommand]),
  Command.run({ version: "1.0.0" }),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
)
