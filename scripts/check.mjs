// Copyright 2026 the flareosaur authors. MIT license.
// Type-checks every non-test module with `deno check` against the web
// platform libs only (see compilerOptions.lib in deno.json). The Deno
// namespace is not loaded, so any use of a Deno API fails to compile.
//
// Then type-checks the examples with tsc against @cloudflare/workers-types,
// the way a Worker sees the package: through declarations emitted from the
// packages (tsconfig.decl.json) and the published specifiers
// (tsconfig.paths.json, generated from the deno.json exports).

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TEST_FILE = /(_test|[\\/]test|_test_utils?|_testing)\.ts$/;

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    if (name === "testdata") return [];
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

// The package directories, from the targets of the root deno.json exports.
const exportTargets = Object.values(
  JSON.parse(readFileSync(join(ROOT, "deno.json"), "utf8")).exports,
);
const packages = [...new Set(exportTargets.map((t) => t.split("/")[1]))];
const files = packages
  .flatMap((pkg) => walk(join(ROOT, pkg)))
  .filter((f) => f.endsWith(".ts") && !TEST_FILE.test(f))
  .map((f) => relative(ROOT, f));

const run = (bin, args) =>
  spawnSync(join(ROOT, "node_modules/.bin", bin), args, {
    cwd: ROOT,
    stdio: "inherit",
  }).status ?? 1;

if (run("deno", ["check", "--quiet", ...process.argv.slice(2), ...files])) {
  process.exit(1);
}

const config = JSON.parse(readFileSync(join(ROOT, "deno.json"), "utf8"));
const paths = Object.fromEntries(
  Object.entries(config.exports).map(([key, target]) => [
    config.name + key.slice(1),
    [`./node_modules/.flareosaur-types/${target.slice(2).replace(/\.ts$/, ".d.ts")}`],
  ]),
);
writeFileSync(
  join(ROOT, "tsconfig.paths.json"),
  JSON.stringify({ compilerOptions: { paths } }, null, 2) + "\n",
);
process.exit(
  run("tsc", ["-p", "tsconfig.decl.json"]) || run("tsc", ["-p", "tsconfig.json"]),
);
