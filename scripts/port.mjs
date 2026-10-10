// Copyright 2026 the flareosaur authors. MIT license.
// Ports packages from a denoland/std checkout into this repo.
//
//   node scripts/port.mjs [path/to/std]
//
// Steps: copy the selected packages, drop files that need Deno or Node APIs,
// rename @std/* to @flareosaur/*, turn crypto's inline wasm into a .wasm
// module import, then apply patches/*.patch for the hand-made edge fixes.

import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STD = resolve(process.argv[2] ?? join(ROOT, "../std"));
const SCOPE = "@flareosaur";

// Package name -> files to leave out (paths relative to the package, a
// trailing slash means a directory) or `only` to copy just those files.
const PACKAGES = {
  assert: {},
  async: {},
  bytes: {},
  cache: {},
  collections: {},
  crypto: {
    exclude: [
      "_wasm/src/",
      "_wasm/Cargo.toml",
      "_wasm/Cargo.lock",
      "_wasm/rust-toolchain.toml",
      "_wasm/test.ts",
      "_wasm/README.md",
    ],
  },
  csv: {},
  data_structures: {},
  datetime: {},
  // load.ts and the load*() functions read .env files from disk.
  dotenv: { exclude: ["load.ts"] },
  encoding: {},
  fmt: {},
  front_matter: {},
  html: {},
  // The file server needs a filesystem.
  http: {
    exclude: [
      "file_server.ts",
      "file_server_test.ts",
      "unstable_file_server.ts",
      "unstable_file_server_test.ts",
      "testdata/desktop.ini",
      "testdata/file_server_as_library.ts",
      "testdata/hello.html",
      "testdata/nested-subdirs/",
      "testdata/subdir-with-index/",
      "testdata/test_clean_urls/",
      "testdata/test_clean_urls.html",
      "testdata/test_empty_file.txt",
      "testdata/test_file.txt",
    ],
    dropExports: ["./file-server", "./unstable-file-server"],
  },
  internal: {},
  json: {},
  jsonc: {},
  media_types: { exclude: ["vendor/update.ts"] },
  path: {},
  regexp: {},
  semver: {},
  streams: {},
  // Only the runner-independent parts. bdd and snapshot are built on
  // Deno.test and the filesystem.
  testing: {
    only: [
      "README.md",
      "deno.json",
      "_mock_utils.ts",
      "_test_utils.ts",
      "_time.ts",
      "mock.ts",
      "mock_test.ts",
      "time.ts",
      "time_test.ts",
      "types.ts",
      "types_test.ts",
      "unstable_stub.ts",
      "unstable_stub_test.ts",
      "unstable_stub_property.ts",
      "unstable_stub_property_test.ts",
      "unstable_types.ts",
      "unstable_types_test.ts",
    ],
    dropExports: [
      "./bdd",
      "./snapshot",
      "./unstable-bdd",
      "./unstable-snapshot",
    ],
  },
  text: {},
  toml: {},
  ulid: {},
  uuid: {},
  yaml: {},
};

const TEXT = /\.(ts|mts|mjs|js|json|jsonc|md)$/;

function skip(rel, opts) {
  if (opts.only) return !opts.only.includes(rel);
  if (/(^|\/)_benches?\//.test(rel) || /_bench\.ts$/.test(rel)) return true;
  return (opts.exclude ?? []).some((e) =>
    e.endsWith("/") ? rel.startsWith(e) : rel === e
  );
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function rename(src) {
  return src
    .replaceAll("jsr:@std/", `jsr:${SCOPE}/`)
    .replaceAll('"@std/', `"${SCOPE}/`)
    .replaceAll("'@std/", `'${SCOPE}/`)
    .replaceAll("`@std/", `\`${SCOPE}/`)
    .replaceAll(" @std/", ` ${SCOPE}/`)
    .replaceAll("(@std/", `(${SCOPE}/`);
}

function portPackage(name, opts) {
  const from = join(STD, name);
  const to = join(ROOT, name);
  rmSync(to, { recursive: true, force: true });
  for (const file of walk(from)) {
    const rel = relative(from, file);
    if (skip(rel, opts)) continue;
    const dest = join(to, rel);
    mkdirSync(dirname(dest), { recursive: true });
    if (TEXT.test(file)) {
      writeFileSync(dest, rename(readFileSync(file, "utf8")));
    } else {
      cpSync(file, dest);
    }
  }
  const denoJson = join(to, "deno.json");
  const config = JSON.parse(readFileSync(denoJson, "utf8"));
  for (const key of opts.dropExports ?? []) delete config.exports[key];
  writeFileSync(denoJson, JSON.stringify(config, null, 2) + "\n");
}

// workerd refuses to compile wasm from bytes at runtime, so the inline base64
// blob becomes a .wasm file imported as a WebAssembly.Module.
function externalizeWasm() {
  const lib = join(ROOT, "crypto/_wasm/lib");
  const loaderPath = join(lib, "deno_std_wasm_crypto.mjs");
  const loader = readFileSync(loaderPath, "utf8");
  const match = loader.match(/base64decode\("\\\n([\s\S]*?)"\);/);
  if (!match) throw new Error("crypto: inline wasm not found");
  const bytes = Buffer.from(match[1].replaceAll("\\\n", ""), "base64");
  writeFileSync(join(lib, "deno_std_wasm_crypto.wasm"), bytes);
  writeFileSync(
    loaderPath,
    `// @generated by scripts/port.mjs from the wasmbuild output -- do not edit
// @ts-nocheck: generated
// deno-lint-ignore-file
// deno-fmt-ignore-file
// @ts-self-types="./deno_std_wasm_crypto.d.mts"

import * as imports from "./deno_std_wasm_crypto.internal.mjs";
import wasmModule from "./deno_std_wasm_crypto.wasm";
const wasm = new WebAssembly.Instance(wasmModule, {
  "./deno_std_wasm_crypto.internal.mjs": imports,
});

export * from "./deno_std_wasm_crypto.internal.mjs";
import { __wbg_set_wasm } from "./deno_std_wasm_crypto.internal.mjs";
__wbg_set_wasm(wasm.exports);
wasm.exports.__wbindgen_start();
`,
  );
}

// tsc and the test bundler resolve @flareosaur/* through these paths.
function writeTsconfigPaths() {
  const paths = {};
  for (const name of Object.keys(PACKAGES)) {
    const { name: pkg, exports } = JSON.parse(
      readFileSync(join(ROOT, name, "deno.json"), "utf8"),
    );
    const entries = typeof exports === "string" ? { ".": exports } : exports;
    for (const [sub, file] of Object.entries(entries)) {
      paths[sub === "." ? pkg : `${pkg}/${sub.slice(2)}`] = [
        `./${name}/${file.slice(2)}`,
      ];
    }
  }
  writeFileSync(
    join(ROOT, "tsconfig.paths.json"),
    JSON.stringify({ compilerOptions: { paths } }, null, 2) + "\n",
  );
}

function writeWorkspace() {
  const path = join(ROOT, "deno.json");
  const config = JSON.parse(readFileSync(path, "utf8"));
  config.workspace = Object.keys(PACKAGES).map((n) => `./${n}`);
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n");
}

if (!existsSync(join(STD, "deno.json"))) {
  console.error(`No std checkout at ${STD}`);
  process.exit(1);
}
for (const [name, opts] of Object.entries(PACKAGES)) portPackage(name, opts);
externalizeWasm();
writeTsconfigPaths();
writeWorkspace();

const patches = join(ROOT, "patches");
if (existsSync(patches) && !process.argv.includes("--no-patches")) {
  for (const p of readdirSync(patches).filter((f) => f.endsWith(".patch")).sort()) {
    execFileSync("git", ["apply", "--whitespace=nowarn", join(patches, p)], {
      cwd: ROOT,
      stdio: "inherit",
    });
    console.log(`applied ${p}`);
  }
}
const rev = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: STD })
  .toString().trim();
writeFileSync(join(ROOT, "UPSTREAM"), `denoland/std@${rev}\n`);
console.log(`ported ${Object.keys(PACKAGES).length} packages from std@${rev}`);
